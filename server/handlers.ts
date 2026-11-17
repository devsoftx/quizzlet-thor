import { MAX_ROUND_LENGTH, scoreRound } from "../src/points.js";
import { createHash } from "node:crypto";
import { deckIsFor } from "../src/account-shared.js";
import { requireAccount } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { kidDevice, kidProfile } from "./kid-handlers.js";
import { cleanName, cookie, error, json, NAME_MAX, readCookie, readJson } from "./http.js";
import { SESSION_TTL_SECONDS, type Session } from "./store.js";

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

async function currentSession(request: Request, deps: Deps): Promise<Session | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !deps.store) return null;
  const session = await deps.store.getSession(id, deps.now());
  if (!session?.linkedDeviceId) return session;
  const device = await kidDevice(request, deps);
  if (!device || device.id !== session.linkedDeviceId || device.accountId !== session.linkedAccountId || device.profileId !== session.profileId) return null;
  if (!deps.accounts || !(await deps.accounts.forAccount(device.accountId).getProfile(device.profileId))) return null;
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
export async function getSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
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
    const name = cleanName(body?.name);
    if (!name) {
      return error(400, `Please enter a nickname (up to ${NAME_MAX} letters, numbers or spaces).`);
    }
    player = { name, playerKey: playerKeyFor(name), listed: true };
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
}

/** DELETE: end the session now. */
export async function endSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const id = readCookie(request, SESSION_COOKIE);
  if (id && deps.store) await deps.store.deleteSession(id);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
}

// -------------------------------------------------------------- /api/score

/**
 * POST {answers: boolean[], streakBefore?, leaderboard?}: save points for answers.
 * The app saves answers as they're given, so a round arrives in pieces:
 * `streakBefore` carries the streak over from the previous piece, and
 * `leaderboard: false` skips the leaderboard until the round's last piece.
 * An empty list is allowed only to ask for the totals and leaderboard.
 */
export async function submitScore(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  if (!session) return (await linkedSessionWasRevoked(request, deps))
    ? error(403, "This device is no longer linked. Ask an adult for a new link.")
    : error(401, "Your session has ended. Start a new one to save points.");

  const body = await readJson(request);
  if (body?.sessionTag !== undefined && body.sessionTag !== scoreSessionTag(session)) return error(409, "This score belongs to a different session.");
  if (body?.deckId !== undefined) {
    if (typeof body.deckId !== "string" || !(await canAccessPrivateDeck(session, body.deckId, deps))) return error(403, "This deck is no longer available.");
  }
  const answers = body?.answers;
  const wantsBoard = body?.leaderboard !== false;
  const streakBefore = body?.streakBefore ?? 0;
  if (
    !Array.isArray(answers) ||
    (answers.length === 0 && body?.leaderboard !== true) ||
    answers.length > MAX_ROUND_LENGTH ||
    !answers.every((a) => typeof a === "boolean")
  ) {
    return error(400, "answers must be a list of true/false values.");
  }
  if (!Number.isInteger(streakBefore) || (streakBefore as number) < 0 || (streakBefore as number) > MAX_ROUND_LENGTH) {
    return error(400, "streakBefore must be a whole number.");
  }

  const round = scoreRound(answers, streakBefore as number);
  const batchId = body?.batchId;
  if (batchId !== undefined && (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(batchId))) {
    return error(400, "Invalid score batch ID.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ answers, streakBefore, leaderboard: wantsBoard, deckId: body?.deckId ?? null })).digest("hex");
  const saved = batchId === undefined
    ? await deps.store.addPoints(session, round.points)
    : await deps.store.addScoreBatch(session, batchId as string, fingerprint, round.points, deps.now());
  if (saved === "conflict") return error(409, "This score batch was already used for different answers.");
  if (saved === "expired") return error(401, "Your session has ended. Start a new one to save points.");
  const { sessionPoints, totalPoints } = saved;
  // New idempotent batches return a stable score receipt; the board is loaded separately.
  // Legacy clients still receive the board they requested where available.
  const leaderboard = batchId === undefined && wantsBoard ? await deps.store.leaderboard(LEADERBOARD_SIZE, session.playerKey).catch(() => null) : null;
  return json({ pointsEarned: round.points, sessionPoints, totalPoints, leaderboard });
}

// --------------------------------------------------------- /api/leaderboard

/**
 * GET: the top players. Public (no sign-in); "you" is the current session's
 * player, or, between sessions, the kid profile this device is linked to.
 */
export async function getLeaderboard(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  const kid = session ? null : await kidProfile(request, deps);
  const playerKey = session?.playerKey ?? (kid ? `p:${kid.id}` : undefined);
  return json(await deps.store.leaderboard(LEADERBOARD_SIZE, playerKey));
}
