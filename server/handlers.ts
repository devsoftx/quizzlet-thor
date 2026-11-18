import { MAX_ROUND_LENGTH } from "../src/points.js";
import { createHash } from "node:crypto";
import { deckIsFor } from "../src/account-shared.js";
import { requireAccount } from "./account-handlers.js";
import type { Deps } from "./deps.js";
import { kidDevice, kidProfile } from "./kid-handlers.js";
import { cookie, error, json, readCookie, readJson } from "./http.js";
import { noLog } from "./log.js";
import { checkName, nameProblemMessage } from "./names.js";
import { route } from "./route.js";
import { PACE_BURST, PACE_MS_PER_ANSWER, SESSION_TTL_SECONDS, type Session } from "./store.js";

export type { Deps } from "./deps.js";
export { cleanName, readCookie } from "./http.js";

export const SESSION_COOKIE = "qz_session";
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

/**
 * The live session for this request. A session that plays as a kid profile is
 * checked against the database every time: once the profile (or the whole
 * account) is deleted, or the device it was started from is unlinked, the
 * session is over, so nothing can be scored for a player who no longer exists.
 */
async function currentSession(request: Request, deps: Deps): Promise<Session | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !deps.store) return null;
  const session = await deps.store.getSession(id, deps.now());
  if (!session) return null;
  if (session.linkedDeviceId) {
    const device = await kidDevice(request, deps);
    if (!device || device.id !== session.linkedDeviceId || device.accountId !== session.linkedAccountId || device.profileId !== session.profileId) return null;
  }
  if (session.profileId) {
    const accountId = session.accountId ?? session.linkedAccountId;
    if (!accountId || !deps.accounts) return null;
    if (!(await deps.accounts.forAccount(accountId).getProfile(session.profileId))) return null;
  }
  return session;
}

/** Distinguish a still-live session whose linked-device access was removed. */
async function linkedSessionWasRevoked(request: Request, deps: Deps): Promise<boolean> {
  const id = readCookie(request, SESSION_COOKIE);
  const session = id && deps.store ? await deps.store.getSession(id, deps.now()) : null;
  return !!session?.linkedDeviceId;
}

// ------------------------------------------------------------ /api/session

/**
 * GET: the current session, or `null` if there is none (or it expired). The app
 * asks on every page load, so "nobody is playing" is a normal 200 answer rather
 * than an error the browser flags.
 * GET ?deckId=: the same, but also checks a private deck is still assigned; here
 * a missing session is a 401, so an ended session can't pass the check.
 */
export const getSession = route({ name: "session.get" }, async (request, deps) => {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  const deckId = new URL(request.url).searchParams.get("deckId");
  if (!session) {
    const hadCookie = readCookie(request, SESSION_COOKIE) !== null;
    if (await linkedSessionWasRevoked(request, deps)) return json({ error: "This device is no longer linked. Ask an adult for a new link." }, 403, { "set-cookie": clearCookie(request) });
    const clear: HeadersInit = hadCookie ? { "set-cookie": clearCookie(request) } : {};
    return deckId ? json({ error: "No active session." }, 401, clear) : json(null, 200, clear);
  }
  if (deckId && !(await canAccessPrivateDeck(session, deckId, deps))) return error(403, "This deck is no longer available.");
  return json(publicSession(session, deps.now()));
});

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
export const startSession = route({ name: "session.start", limit: "session" }, async (request, deps) => {
  if (!deps.store) return storageMissing();
  const body = await readJson(request);

  let player: Pick<Session, "name" | "playerKey" | "profileId" | "listed" | "linkedDeviceId" | "linkedAccountId" | "accountId">;
  if (body?.kid === true || typeof body?.profileId === "string") {
    let profile;
    let device: Awaited<ReturnType<typeof kidDevice>> = null;
    let accountId: string | undefined;
    if (body?.kid === true) {
      device = await kidDevice(request, deps);
      profile = device ? await deps.accounts!.forAccount(device.accountId).getProfile(device.profileId) : null;
      if (!profile) return error(401, "This device isn't linked to a profile anymore. Ask your parent for a new link.");
    } else {
      const account = await requireAccount(request, deps);
      if (account instanceof Response) return account;
      accountId = account.userId;
      profile = await account.scope.getProfile(body!.profileId as string);
      if (!profile) return error(404, "Profile not found.");
    }
    player = {
      name: profile.nickname,
      playerKey: `p:${profile.id}`, // guest names can't contain ":", so no collisions
      profileId: profile.id,
      listed: profile.showOnLeaderboard,
      ...(device ? { linkedDeviceId: device.id, linkedAccountId: device.accountId } : {}),
      ...(accountId ? { accountId } : {}),
    };
  } else {
    const checked = checkName(body?.name);
    if (!checked.ok) return error(400, nameProblemMessage(checked.problem));
    player = { name: checked.name, playerKey: playerKeyFor(checked.name), listed: true };
  }

  // Replace any session this browser already had.
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) await deps.store.deleteSession(previous);

  const now = deps.now();
  const session: Session = {
    id: deps.newId(),
    ...player,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    points: 0,
  };
  await deps.store.createSession(session);
  return json(publicSession(session, now), 201, {
    "set-cookie": sessionCookie(request, session.id, SESSION_TTL_SECONDS),
  });
});

/** DELETE: end the session now. */
export const endSession = route({ name: "session.end" }, async (request, deps) => {
  const id = readCookie(request, SESSION_COOKIE);
  if (id && deps.store) await deps.store.deleteSession(id);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
});

// -------------------------------------------------------------- /api/score

/**
 * POST {batchId, answers: boolean[], streakBefore?, leaderboard?, deckId?, sessionTag?}:
 * save points for answers. The app saves answers as they're given, so a round
 * arrives in pieces, each with its own `batchId`; sending a batch again returns
 * the first result instead of counting it twice.
 *
 * The streak is kept in the session, not taken from the browser: `streakBefore`
 * can only lower it (a new round starts from 0), never raise it. Saves beyond
 * the session's pace cap are answered 429 and add nothing; the same batch can
 * be sent again a little later.
 *
 * An empty list is allowed only with `leaderboard: true`, to read the totals.
 */
export const submitScore = route({ name: "score.submit", limit: "score" }, async (request, deps) => {
  if (!deps.store) return storageMissing();
  const log = deps.log ?? noLog;
  const session = await currentSession(request, deps);
  if (!session) return (await linkedSessionWasRevoked(request, deps))
    ? error(403, "This device is no longer linked. Ask an adult for a new link.")
    : error(401, "Your session has ended. Start a new one to save points.");
  // Never the session id itself (it is the cookie): a short piece of its public tag.
  const rejected = (status: number, reason: string) =>
    log({ event: "score.rejected", status, reason, session: scoreSessionTag(session).slice(0, 12), profile: session.profileId ?? null });

  const body = await readJson(request);
  if (body?.sessionTag !== undefined && body.sessionTag !== scoreSessionTag(session)) {
    rejected(409, "session_mismatch");
    return error(409, "This score belongs to a different session.");
  }
  if (body?.deckId !== undefined) {
    if (typeof body.deckId !== "string" || !(await canAccessPrivateDeck(session, body.deckId, deps))) return error(403, "This deck is no longer available.");
  }
  const answers = body?.answers;
  const wantsBoard = body?.leaderboard !== false;
  const streakBefore = body?.streakBefore;
  if (
    !Array.isArray(answers) ||
    (answers.length === 0 && body?.leaderboard !== true) ||
    answers.length > MAX_ROUND_LENGTH ||
    !answers.every((a) => typeof a === "boolean")
  ) {
    return error(400, "answers must be a list of true/false values.");
  }
  if (streakBefore !== undefined && (!Number.isInteger(streakBefore) || (streakBefore as number) < 0 || (streakBefore as number) > MAX_ROUND_LENGTH)) {
    return error(400, "streakBefore must be a whole number.");
  }
  const batchId = body?.batchId;
  if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(batchId)) {
    return error(400, batchId === undefined ? "A score batch ID is required." : "Invalid score batch ID.");
  }

  const fingerprint = createHash("sha256").update(JSON.stringify({ answers, streakBefore: streakBefore ?? 0, leaderboard: wantsBoard, deckId: body?.deckId ?? null })).digest("hex");
  const now = deps.now();
  const saved = await deps.store.addScoreBatch(session, { id: batchId, fingerprint, answers: answers as boolean[], streakCap: streakBefore as number | undefined }, now);
  if (saved === "conflict") {
    rejected(409, "batch_conflict");
    return error(409, "This score batch was already used for different answers.");
  }
  if (saved === "expired") return error(401, "Your session has ended. Start a new one to save points.");
  if (saved === "too-fast") {
    rejected(429, "pace");
    // When the session will be old enough for this batch to fit.
    const startedAt = session.expiresAt - SESSION_TTL_SECONDS * 1000;
    const fitsAt = startedAt + ((session.answers ?? 0) + answers.length - PACE_BURST) * PACE_MS_PER_ANSWER;
    const retryAfter = Math.max(1, Math.ceil((fitsAt - now) / 1000));
    return error(429, "You're answering faster than points can be saved. Wait a moment and try again.", { "retry-after": String(retryAfter) });
  }
  // The receipt is stable across retries, so the board isn't part of it: the app loads it separately.
  return json({ ...saved, leaderboard: null });
});

// --------------------------------------------------------- /api/leaderboard

/**
 * GET: the top players. Public (no sign-in); "you" is the current session's
 * player, or, between sessions, the kid profile this device is linked to.
 */
export const getLeaderboard = route({ name: "leaderboard.get", limit: "leaderboard" }, async (request, deps) => {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  const kid = session ? null : await kidProfile(request, deps);
  const playerKey = session?.playerKey ?? (kid ? `p:${kid.id}` : undefined);
  return json(await deps.store.leaderboard(LEADERBOARD_SIZE, playerKey));
});
