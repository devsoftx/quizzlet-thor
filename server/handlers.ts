import { MAX_ROUND_LENGTH, scoreRound } from "../src/points.js";
import { getStore, SESSION_TTL_SECONDS, type Session, type Store } from "./store.js";

export const SESSION_COOKIE = "qz_session";
const LEADERBOARD_SIZE = 10;
const NAME_MAX = 24;

export interface Deps {
  store: Store | null;
  now: () => number;
  newId: () => string;
}

function defaultDeps(): Deps {
  return {
    store: getStore(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  };
}

// ------------------------------------------------------------- Helpers

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

const error = (status: number, message: string) => json({ error: message }, status);

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

/** Trim and collapse spaces; letters, numbers, spaces, - ' . only. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) return null;
  return name;
}

export const playerKeyFor = (name: string) => name.toLocaleLowerCase("en");

function publicSession(session: Session, now: number) {
  return {
    name: session.name,
    points: session.points,
    expiresAt: session.expiresAt,
    secondsLeft: Math.max(0, Math.round((session.expiresAt - now) / 1000)),
  };
}

async function currentSession(request: Request, deps: Deps): Promise<Session | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id || !deps.store) return null;
  return deps.store.getSession(id, deps.now());
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

/** POST {name}: start a new 60-minute session. */
export async function startSession(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.store) return storageMissing();
  const body = await readJson(request);
  const name = cleanName(body?.name);
  if (!name) {
    return error(400, `Please enter a nickname (up to ${NAME_MAX} letters, numbers or spaces).`);
  }

  // Replace any session this browser already had.
  const previous = readCookie(request, SESSION_COOKIE);
  if (previous) await deps.store.deleteSession(previous);

  const now = deps.now();
  const session: Session = {
    id: deps.newId(),
    name,
    playerKey: playerKeyFor(name),
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
