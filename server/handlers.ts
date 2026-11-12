import { MAX_ROUND_LENGTH, scoreRound } from "../src/points.js";
import { requireAccount } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { cleanName, error, json, NAME_MAX, readJson } from "./http.js";
import { SESSION_TTL_SECONDS, type Session } from "./store.js";

export type { Deps } from "./deps.js";
export { cleanName } from "./http.js";

export const SESSION_COOKIE = "qz_session";
const LEADERBOARD_SIZE = 10;

// ------------------------------------------------------------- Helpers

const storageMissing = () =>
  error(503, "The leaderboard database isn't connected yet. Ask the site owner to set up storage.");

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isHttps(request: Request): boolean {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

function sessionCookie(request: Request, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

const clearCookie = (request: Request) => sessionCookie(request, "", 0);

export const playerKeyFor = (name: string) => name.toLocaleLowerCase("en");

function publicSession(session: Session, now: number) {
  return {
    name: session.name,
    points: session.points,
    expiresAt: session.expiresAt,
    secondsLeft: Math.max(0, Math.round((session.expiresAt - now) / 1000)),
    profileId: session.profileId ?? null,
  };
}

async function currentSession(request: Request, deps: Deps): Promise<Session | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !deps.store) return null;
  return deps.store.getSession(id, deps.now());
}

// ------------------------------------------------------------ /api/session

/** GET: the current session, or 401 if there is none (or it expired). */
export async function getSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  if (!session) {
    const hadCookie = readCookie(request, SESSION_COOKIE) !== null;
    return json({ error: "No active session." }, 401, hadCookie ? { "set-cookie": clearCookie(request) } : {});
  }
  return json(publicSession(session, deps.now()));
}

/**
 * POST {name}: start a 60-minute guest session.
 * POST {profileId}: a signed-in parent starts a session for one of their kid profiles.
 */
export async function startSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const body = await readJson(request);

  let player: Pick<Session, "name" | "playerKey" | "profileId" | "listed">;
  if (typeof body?.profileId === "string") {
    const account = await requireAccount(request, deps);
    if (account instanceof Response) return account;
    const profile = await account.scope.getProfile(body.profileId);
    if (!profile) return error(404, "Profile not found.");
    player = {
      name: profile.nickname,
      playerKey: `p:${profile.id}`, // guest names can't contain ":", so no collisions
      profileId: profile.id,
      listed: profile.showOnLeaderboard,
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

/** POST {answers: boolean[]}: score a finished round and return the leaderboard. */
export async function submitScore(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  if (!session) return error(401, "Your session has ended. Start a new one to save points.");

  const body = await readJson(request);
  const answers = body?.answers;
  if (
    !Array.isArray(answers) ||
    answers.length === 0 ||
    answers.length > MAX_ROUND_LENGTH ||
    !answers.every((a) => typeof a === "boolean")
  ) {
    return error(400, "answers must be a list of true/false values.");
  }

  const round = scoreRound(answers);
  const { sessionPoints, totalPoints } = await deps.store.addPoints(session, round.points);
  const leaderboard = await deps.store.leaderboard(LEADERBOARD_SIZE, session.playerKey);
  return json({ pointsEarned: round.points, sessionPoints, totalPoints, leaderboard });
}

// --------------------------------------------------------- /api/leaderboard

export async function getLeaderboard(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const session = await currentSession(request, deps);
  return json(await deps.store.leaderboard(LEADERBOARD_SIZE, session?.playerKey));
}
