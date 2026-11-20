import { MAX_ROUND_LENGTH } from "../src/points.js";
import { parseAttemptDetails } from "../src/attempts.js";
import { createHash, randomBytes } from "node:crypto";
import { deckIsFor } from "../src/account-shared.js";
import { requireAccount } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { DEFAULT_FLAGS, isBlockedName } from "./flags.js";
import { kidDevice, kidProfile } from "./kid-handlers.js";
import { cookie, error, json, readCookie, readJson } from "./http.js";
import { checkName, nameProblemMessage } from "./names.js";
import { errorName, securityEvent, sessionHash } from "./log.js";
import { GUEST_NAME_DAYS, SESSION_TTL_SECONDS, type Session } from "./store.js";

export type { Deps } from "./deps.js";
export { cleanName, readCookie } from "./http.js";

export const SESSION_COOKIE = "qz_session";
/** A long-lived random id for this browser; a guest nickname belongs to the browser that first used it. */
export const GUEST_COOKIE = "qz_guest";
const LEADERBOARD_SIZE = 10;

// ------------------------------------------------------------- Helpers

const storageMissing = () =>
  error(503, "The leaderboard database isn't connected yet. Ask the site owner to set up storage.");

const sessionCookie = (request: Request, value: string, maxAgeSeconds: number) =>
  cookie(request, SESSION_COOKIE, value, maxAgeSeconds);

const clearCookie = (request: Request) => sessionCookie(request, "", 0);

export const playerKeyFor = (name: string) => name.toLocaleLowerCase("en");

// A non-cookie identifier lets a delayed score request detect session replacement.
const scoreSessionTag = (session: Session) => createHash("sha256").update(`score-session:${session.id}`).digest("hex");

const isSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const guestOwnerHash = (secret: string) => createHash("sha256").update(`guest-owner:${secret}`).digest("hex");

const flagsFor = (deps: Deps) => deps.flags?.() ?? Promise.resolve(DEFAULT_FLAGS);

function publicSession(session: Session, now: number) {
  return {
    name: session.name,
    points: session.points,
    expiresAt: session.expiresAt,
    secondsLeft: Math.max(0, Math.round((session.expiresAt - now) / 1000)),
    profileId: session.profileId ?? null,
    sessionTag: scoreSessionTag(session),
  };
}

/** Does the kid profile behind this session still exist (and, for a linked device, is the device still linked)? */
async function profileSessionIsValid(session: Session, request: Request, deps: Deps): Promise<boolean> {
  if (session.linkedDeviceId) {
    const device = await kidDevice(request, deps);
    if (!device || device.id !== session.linkedDeviceId || device.accountId !== session.linkedAccountId || device.profileId !== session.profileId) return false;
  }
  const accountId = session.accountId ?? session.linkedAccountId;
  if (!accountId || !deps.accounts) return false;
  return (await deps.accounts.forAccount(accountId).getProfile(session.profileId!)) !== null;
}

/**
 * The session for this request. Guests need nothing more than the cookie; a
 * kid profile's session is checked against the database every time, so it
 * stops as soon as the profile, the account or the device link is gone.
 * `revoked` is such a session: still stored, no longer allowed.
 */
async function findSession(request: Request, deps: Deps): Promise<{ session: Session | null; revoked: Session | null }> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !deps.store) return { session: null, revoked: null };
  const session = await deps.store.getSession(id, deps.now());
  if (!session) return { session: null, revoked: null };
  if (!session.profileId || (await profileSessionIsValid(session, request, deps))) return { session, revoked: null };
  return { session: null, revoked: session };
}

/** The 403 for a kid session that was ended from the outside (also logged). */
function revokedResponse(request: Request, revoked: Session, clear: boolean): Response {
  securityEvent("session.revoked", {
    sessionKind: revoked.linkedDeviceId ? "kid" : "profile",
    sessionHash: sessionHash(revoked.id),
    profileId: revoked.profileId ?? null,
  });
  const message = revoked.linkedDeviceId
    ? "This device is no longer linked. Ask an adult for a new link."
    : "This profile is no longer available. Ask an adult to start a new session.";
  return json({ error: message }, 403, clear ? { "set-cookie": clearCookie(request) } : {});
}

// ------------------------------------------------------------ /api/session

/**
 * GET: the current session, or `null` if there is none (or it expired). The app
 * asks on every page load, so "nobody is playing" is a normal 200 answer rather
 * than an error the browser flags.
 * GET ?deckId=: the same, but also checks a private deck is still assigned; here
 * a missing session is a 401, so an ended session can't pass the check.
 */
export async function getSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const { session, revoked } = await findSession(request, deps);
  const deckId = new URL(request.url).searchParams.get("deckId");
  if (!session) {
    if (revoked) return revokedResponse(request, revoked, true);
    const hadCookie = readCookie(request, SESSION_COOKIE) !== null;
    const clear: HeadersInit = hadCookie ? { "set-cookie": clearCookie(request) } : {};
    return deckId ? json({ error: "No active session." }, 401, clear) : json(null, 200, clear);
  }
  if (deckId && !(await canAccessPrivateDeck(session, deckId, deps))) return error(403, "This deck is no longer available.");
  return json(publicSession(session, deps.now()));
}

async function canAccessPrivateDeck(session: Session, deckId: string, deps: Deps): Promise<boolean> {
  const accountId = session.accountId ?? session.linkedAccountId;
  if (!accountId || !session.profileId || !deps.accounts) return false;
  const deck = await deps.accounts.forAccount(accountId).getDeck(deckId);
  return !!deck && deckIsFor(deck, session.profileId);
}

/**
 * POST {name}: start a 60-minute guest session.
 * POST {profileId}: a signed-in parent starts a session for one of their kid profiles.
 * POST {kid: true}: a kid's linked device starts a session for its own profile.
 */
export async function startSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const body = await readJson(request);
  const now = deps.now();
  const cookies: string[] = [];

  let kind: "guest" | "profile" | "kid";
  let player: Pick<Session, "name" | "playerKey" | "profileId" | "listed" | "linkedDeviceId" | "linkedAccountId" | "accountId" | "emoji">;
  if (body?.kid === true || typeof body?.profileId === "string") {
    let profile;
    let device: Awaited<ReturnType<typeof kidDevice>> = null;
    let accountId: string | undefined;
    if (body?.kid === true) {
      kind = "kid";
      device = await kidDevice(request, deps);
      profile = device ? await deps.accounts!.forAccount(device.accountId).getProfile(device.profileId) : null;
      if (!profile) return error(401, "This device isn't linked to a profile anymore. Ask your parent for a new link.");
    } else {
      kind = "profile";
      const account = await requireAccount(request, deps);
      if (account instanceof Response) return account;
      accountId = account.userId;
      profile = await account.scope.getProfile(body.profileId as string);
      if (!profile) return error(404, "Profile not found.");
    }
    player = {
      name: profile.nickname,
      playerKey: `p:${profile.id}`, // guest names can't contain ":", so no collisions
      profileId: profile.id,
      listed: profile.showOnLeaderboard,
      emoji: profile.emoji,
      ...(device ? { linkedDeviceId: device.id, linkedAccountId: device.accountId } : {}),
      ...(accountId ? { accountId } : {}),
    };
  } else {
    kind = "guest";
    // The built-in rules first (allowed characters, one alphabet, the word list), then the operator's list.
    const checked = checkName(body?.name);
    if (!checked.ok) {
      if (checked.problem === "blocked") securityEvent("session.name_blocked", {});
      return error(400, nameProblemMessage(checked.problem));
    }
    const name = checked.name;
    if (isBlockedName(name, await flagsFor(deps))) {
      securityEvent("session.name_blocked", {});
      return error(400, "Please choose a different nickname.");
    }
    // The nickname belongs to the first browser that used it, so nobody else can add to its points.
    const known = readCookie(request, GUEST_COOKIE);
    const guestSecret = isSecret(known) ? known : randomBytes(32).toString("base64url");
    const playerKey = playerKeyFor(name);
    if (!(await deps.store.claimGuestName(playerKey, guestOwnerHash(guestSecret), now))) {
      securityEvent("session.name_taken", {});
      return error(409, "That nickname is taken. Please pick another one.");
    }
    cookies.push(cookie(request, GUEST_COOKIE, guestSecret, GUEST_NAME_DAYS * 24 * 60 * 60));
    player = { name, playerKey, listed: true };
  }

  // Replace any session this browser already had.
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) await deps.store.deleteSession(previous);

  const session: Session = {
    id: deps.newId(),
    ...player,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    points: 0,
  };
  await deps.store.createSession(session);
  securityEvent("session.started", { sessionKind: kind, sessionHash: sessionHash(session.id), profileId: session.profileId ?? null });
  cookies.unshift(sessionCookie(request, session.id, SESSION_TTL_SECONDS));
  return json(publicSession(session, now), 201, cookies.map((value): [string, string] => ["set-cookie", value]));
}

/** DELETE: end the session now. */
export async function endSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const id = readCookie(request, SESSION_COOKIE);
  if (id && deps.store) await deps.store.deleteSession(id);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
}

// -------------------------------------------------------------- /api/score

/**
 * POST {answers: boolean[], batchId, sessionTag, streakBefore?, leaderboard?, deckId?}:
 * save points for answers. The app saves answers as they're given, so a round
 * arrives in pieces; each piece has its own `batchId` and is counted once.
 *
 * The server keeps the streak and the number of answers in the session:
 * `streakBefore` can only lower the streak (a new round sends 0), and answers
 * arriving faster than the pace limit are refused with 429 until time catches up.
 * An empty list is allowed only to ask for the totals (`leaderboard: true`).
 */
export async function submitScore(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const { session, revoked } = await findSession(request, deps);
  if (!session) {
    return revoked
      ? revokedResponse(request, revoked, false)
      : error(401, "Your session has ended. Start a new one to save points.");
  }
  const logFields = { sessionHash: sessionHash(session.id), profileId: session.profileId ?? null };

  const body = await readJson(request);
  if (typeof body?.sessionTag !== "string") return error(400, "This page is out of date. Refresh it to keep saving points.");
  if (body.sessionTag !== scoreSessionTag(session)) {
    securityEvent("score.conflict", { ...logFields, reason: "session" });
    return error(409, "This score belongs to a different session.");
  }
  if (body.deckId !== undefined) {
    if (typeof body.deckId !== "string" || !(await canAccessPrivateDeck(session, body.deckId, deps))) return error(403, "This deck is no longer available.");
  }
  const answers = body.answers;
  const wantsBoard = body.leaderboard !== false;
  const streakBefore = body.streakBefore;
  if (
    !Array.isArray(answers) ||
    (answers.length === 0 && body.leaderboard !== true) ||
    answers.length > MAX_ROUND_LENGTH ||
    !answers.every((a) => typeof a === "boolean")
  ) {
    return error(400, "answers must be a list of true/false values.");
  }
  if (streakBefore !== undefined && (!Number.isInteger(streakBefore) || (streakBefore as number) < 0 || (streakBefore as number) > MAX_ROUND_LENGTH)) {
    return error(400, "streakBefore must be a whole number.");
  }
  const batchId = body.batchId;
  if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(batchId)) {
    return error(400, "Invalid score batch ID.");
  }

  // Details are part of the fingerprint only when sent, so a batch from before they existed matches as it did.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ answers, streakBefore: streakBefore ?? null, leaderboard: wantsBoard, deckId: body.deckId ?? null, ...(body.details !== undefined ? { details: body.details } : {}) }))
    .digest("hex");
  const saved = await deps.store.addScoreBatch(session, { id: batchId, fingerprint, answers, streakBefore: streakBefore as number | undefined }, deps.now());
  if (saved === "conflict") {
    securityEvent("score.conflict", { ...logFields, reason: "batch", batch: batchId });
    return error(409, "This score batch was already used for different answers.");
  }
  if (saved === "expired") return error(401, "Your session has ended. Start a new one to save points.");
  if (saved === "limited") {
    securityEvent("score.limited", { ...logFields, answers: answers.length, batch: batchId });
    return error(429, "That was very fast! Wait a moment and your points will be saved.");
  }
  if (answers.length > 0) {
    securityEvent(saved.replay ? "score.replay" : "score.saved", { ...logFields, answers: answers.length, points: saved.pointsEarned, batch: batchId });
    // Also on a replay: if storing the details failed the first time, this stores them (once).
    if (body.details !== undefined) await recordProgress(session, batchId, answers, body.details, typeof body.deckId === "string" ? body.deckId : undefined, deps, logFields);
  }
  // A batch returns a stable receipt; the leaderboard is loaded separately (GET /api/leaderboard).
  return json({ pointsEarned: saved.pointsEarned, sessionPoints: saved.sessionPoints, totalPoints: saved.totalPoints, leaderboard: null });
}

/**
 * Stores a kid profile's answer details for their parent's Progress page. The
 * points are already saved: details that are refused, or that can't be stored,
 * are logged and dropped, and never cost the learner their points.
 */
async function recordProgress(session: Session, batchId: string, answers: boolean[], raw: unknown, deckId: string | undefined, deps: Deps, logFields: Record<string, string | null>) {
  const accountId = session.accountId ?? session.linkedAccountId;
  if (!session.profileId || !accountId || !deps.accounts) return; // guests' answers are never recorded
  const details = parseAttemptDetails(raw, answers);
  if (typeof details === "string") {
    securityEvent("progress.refused", { ...logFields, batch: batchId, reason: details });
    return;
  }
  // A private deck's answers must name the deck this batch was checked for.
  if (details.some((d) => d.deckKey.startsWith("account:") && d.deckKey !== `account:${deckId}`)) {
    securityEvent("progress.refused", { ...logFields, batch: batchId, reason: "deck" });
    return;
  }
  try {
    const attempts = details.map((d, i) => ({ ...d, correct: answers[i] }));
    await deps.accounts.forAccount(accountId).recordAttempts(session.profileId, batchId, attempts, new Date(deps.now()).toISOString());
  } catch (err) {
    securityEvent("progress.error", { ...logFields, batch: batchId, errorName: errorName(err) });
  }
}

// --------------------------------------------------------- /api/leaderboard

/**
 * GET: the top players. Public (no sign-in); "you" is the current session's
 * player, or, between sessions, the kid profile this device is linked to.
 * An operator can switch the board off (see server/flags.ts): it's then empty.
 */
export async function getLeaderboard(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  if (!(await flagsFor(deps)).enabled) return json({ top: [], you: null });
  const { session } = await findSession(request, deps);
  const kid = session ? null : await kidProfile(request, deps);
  const playerKey = session?.playerKey ?? (kid ? `p:${kid.id}` : undefined);
  return json(await deps.store.leaderboard(LEADERBOARD_SIZE, playerKey));
}
