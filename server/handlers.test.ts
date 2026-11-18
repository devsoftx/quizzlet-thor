import { describe, expect, it } from "vitest";
import { pointsForAnswer, scoreRound } from "../src/points.js";
import { createProfile, deleteMe, deleteProfile, getMe } from "./account-handlers.js";
import { getAccountsDb, MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import { getFileStore } from "./files.js";
import {
  cleanName,
  type Deps,
  endSession,
  getLeaderboard,
  getSession,
  SESSION_COOKIE,
  startSession,
  submitScore,
} from "./handlers.js";
import { getKid, postKid } from "./kid-handlers.js";
import { RATE_LIMITS } from "./route.js";
import { getStore, MemoryStore, PACE_BURST, PACE_MS_PER_ANSWER } from "./store.js";

// A loopback name: the local sign-in stand-in answers nowhere else.
const BASE = "https://localhost";

class TestAuth extends DevAuthenticator {
  override async deleteUser() {}
}

function setup() {
  let clock = Date.UTC(2026, 10, 7, 12, 0, 0);
  let ids = 0;
  /** The store's own records, to look at what it keeps. */
  const state = { sessions: new Map(), totals: new Map<string, number>(), names: new Map<string, string>(), hidden: new Set<string>() };
  const deps: Deps = {
    store: new MemoryStore(state),
    accounts: new MemoryAccounts(),
    auth: new TestAuth(),
    now: () => clock,
    newId: () => `id-${++ids}`,
  };
  return { deps, state, advance: (ms: number) => (clock += ms) };
}

interface ReqInit {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** Sign in as this (made-up) parent. */
  user?: string;
  headers?: Record<string, string>;
}

function req(path: string, init: ReqInit = {}) {
  const headers = new Headers({ "content-type": "application/json", ...init.headers });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

let batches = 0;
/** Saves answers the way the app does: every save has its own batch id. */
function score(deps: Deps, cookie: string | undefined, body: Record<string, unknown>) {
  return submitScore(req("/api/score", { method: "POST", cookie, body: { batchId: `batch-${++batches}`, ...body } }), deps);
}

/** "qz_session=id-1; Path=/; ..." -> "qz_session=id-1" */
const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

async function login(deps: Deps, name: string) {
  const res = await startSession(req("/api/session", { method: "POST", body: { name } }), deps);
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

describe("points", () => {
  it("gives 10 per correct answer and +5 from the third in a row", () => {
    expect(pointsForAnswer(true, 0)).toEqual({ points: 10, streak: 1, bonus: false });
    expect(pointsForAnswer(true, 2)).toEqual({ points: 15, streak: 3, bonus: true });
    expect(pointsForAnswer(false, 5)).toEqual({ points: 0, streak: 0, bonus: false });
    // ✓✓✓✓ ✗ ✓ = 10+10+15+15 + 0 + 10
    expect(scoreRound([true, true, true, true, false, true])).toEqual({ points: 60, correct: 5, bestStreak: 4, streak: 1 });
    expect(scoreRound([true], 2)).toMatchObject({ points: 15, streak: 3 }); // a streak carried over from earlier answers
  });
});

describe("cleanName", () => {
  it("accepts normal names and tidies spaces", () => {
    expect(cleanName("  Ana   María ")).toBe("Ana María");
    expect(cleanName("O'Neil-2")).toBe("O'Neil-2");
  });
  it("rejects empty, too long or odd names", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(25))).toBeNull();
    expect(cleanName("<script>")).toBeNull();
    expect(cleanName(42)).toBeNull();
  });
});

describe("guest names on the public board", () => {
  it("rejects a blocked or mixed-alphabet nickname with 400", async () => {
    const { deps } = setup();
    const start = (name: string) => startSession(req("/api/session", { method: "POST", body: { name } }), deps);

    const blocked = await start("Sh1thead");
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: "That nickname isn't allowed. Please choose a different one." });
    expect(blocked.headers.get("set-cookie")).toBeNull();

    // "Аna" with a Cyrillic А would sit on the board looking like "Ana".
    const lookalike = await start("\u0410na");
    expect(lookalike.status).toBe(400);
    expect(await lookalike.json()).toEqual({ error: "Please use letters from one alphabet in your nickname." });

    expect((await start("Ana")).status).toBe(201);
  });

  it("holds kid profile nicknames to the same rules", async () => {
    const { deps } = setup();
    for (const nickname of ["Sh1thead", "\u0410na"]) {
      const res = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname } }), deps);
      expect(res.status).toBe(400);
    }
  });
});

describe("sessions", () => {
  it("starts a 60-minute session with a secure HttpOnly cookie", async () => {
    const { deps } = setup();
    const res = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps);
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=id-1`);
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(await res.json()).toMatchObject({ name: "Ana", points: 0, secondsLeft: 3600 });
  });

  it("leaves out Secure on plain http (local dev)", async () => {
    const { deps } = setup();
    const res = await startSession(
      new Request("http://localhost:5173/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ana" }),
      }),
      deps,
    );
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("rejects a bad name", async () => {
    const { deps } = setup();
    const res = await startSession(req("/api/session", { method: "POST", body: { name: "" } }), deps);
    expect(res.status).toBe(400);
  });

  it("returns the session until it expires after 60 minutes", async () => {
    const { deps, advance } = setup();
    const cookie = await login(deps, "Ana");

    advance(59 * 60 * 1000);
    const live = await getSession(req("/api/session", { cookie }), deps);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ name: "Ana", secondsLeft: 60 });

    advance(60 * 1000);
    const expired = await getSession(req("/api/session", { cookie }), deps);
    expect(expired.status).toBe(200);
    expect(await expired.json()).toBeNull();
    expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("answers null (not an error) without a session, and ends a session on DELETE", async () => {
    const { deps } = setup();
    const none = await getSession(req("/api/session"), deps);
    expect(none.status).toBe(200);
    expect(await none.json()).toBeNull();
    expect(none.headers.get("set-cookie")).toBeNull(); // nothing to clear

    const cookie = await login(deps, "Ana");
    const res = await endSession(req("/api/session", { method: "DELETE", cookie }), deps);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const ended = await getSession(req("/api/session", { cookie }), deps);
    expect(ended.status).toBe(200);
    expect(await ended.json()).toBeNull();
  });

  it("still 401s a private-deck check when there is no session", async () => {
    const { deps } = setup();
    const res = await getSession(req("/api/session?deckId=some-deck"), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "No active session." });
  });

  it("doesn't keep a guest's name until they earn points", async () => {
    const { deps, state } = setup();
    const cookie = await login(deps, "Ana");
    await getSession(req("/api/session", { cookie }), deps);
    await getLeaderboard(req("/api/leaderboard", { cookie }), deps);
    expect(state.names.size).toBe(0);
    expect(state.totals.size).toBe(0);

    await score(deps, cookie, { answers: [true] });
    expect([...state.names]).toEqual([["ana", "Ana"]]);
  });

  it("treats a cookie that isn't valid text as no cookie, not a server error", async () => {
    const { deps } = setup();
    for (const cookie of [`${SESSION_COOKIE}=%E0%A4%A`, `${SESSION_COOKIE}=%`, "qz_kid=%ZZ"]) {
      const current = await getSession(req("/api/session", { cookie }), deps);
      expect(current.status).toBe(200);
      expect(await current.json()).toBeNull();
      expect((await score(deps, cookie, { answers: [true] })).status).toBe(401);
      expect((await getLeaderboard(req("/api/leaderboard", { cookie }), deps)).status).toBe(200);
      expect(await (await getKid(req("/api/kid", { cookie }), deps)).json()).toEqual({ kid: null });
      expect((await endSession(req("/api/session", { method: "DELETE", cookie }), deps)).status).toBe(200);
    }
  });
});

describe("scores and leaderboard", () => {
  it("needs an active session", async () => {
    const { deps } = setup();
    const res = await score(deps, undefined, { answers: [true] });
    expect(res.status).toBe(401);
  });

  it("validates the answers list", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    for (const answers of [[], ["yes"], "true", new Array(201).fill(true)]) {
      const res = await score(deps, cookie, { answers });
      expect(res.status).toBe(400);
    }
  });

  it("needs a batch id, so no save can be counted twice", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    const send = (body: Record<string, unknown>) => submitScore(req("/api/score", { method: "POST", cookie, body }), deps);
    const missing = await send({ answers: [true] });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "A score batch ID is required." });
    for (const batchId of ["", "bad id!", 7, "x".repeat(129)]) expect((await send({ answers: [true], batchId })).status).toBe(400);
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ points: 0 });
  });

  it("saves a round in pieces with the same points as all at once", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    const piece = async (body: Record<string, unknown>) => (await score(deps, cookie, body)).json();

    // true, true (20) then true with the streak carried over (10 + 5 bonus): 35, like [true, true, true].
    expect(await piece({ answers: [true, true], streakBefore: 0, leaderboard: false })).toEqual({
      pointsEarned: 20,
      sessionPoints: 20,
      totalPoints: 20,
      leaderboard: null,
    });
    expect(await piece({ answers: [true], streakBefore: 2, leaderboard: false })).toMatchObject({ pointsEarned: 15, sessionPoints: 35 });
    expect(scoreRound([true, true, true]).points).toBe(35);

    // Nothing left to send: an empty list may ask for the totals (the board is loaded on its own).
    expect(await piece({ answers: [], leaderboard: true })).toEqual({ pointsEarned: 0, sessionPoints: 35, totalPoints: 35, leaderboard: null });
    expect((await (await getLeaderboard(req("/api/leaderboard", { cookie }), deps)).json()).top).toEqual([{ rank: 1, name: "Ana", points: 35 }]);

    for (const streakBefore of [-1, 1.5, "2", 201]) {
      const res = await score(deps, cookie, { answers: [true], streakBefore });
      expect(res.status).toBe(400);
    }
  });

  it("starts each round's streak from zero, like the app shows it", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    const earned = async (body: Record<string, unknown>) => (await (await score(deps, cookie, body)).json()).pointsEarned;
    expect(await earned({ answers: [true, true, true], streakBefore: 0 })).toBe(35);
    // The next round begins at 0 in the app: no bonus for its first answers.
    expect(await earned({ answers: [true], streakBefore: 0 })).toBe(10);
    expect(await earned({ answers: [true], streakBefore: 1 })).toBe(10);
    expect(await earned({ answers: [true], streakBefore: 2 })).toBe(15);
  });

  it("earns the same with an inflated streakBefore as without one", async () => {
    const plain = setup();
    const inflated = setup();
    const a = await login(plain.deps, "Ana");
    const b = await login(inflated.deps, "Ana");
    for (const answers of [[true], [true, true], [false, true, true, true]]) {
      const honest = await (await score(plain.deps, a, { answers })).json();
      const cheating = await (await score(inflated.deps, b, { answers, streakBefore: 200 })).json();
      expect(cheating).toEqual(honest);
    }
    // ✓ ✓✓ ✗✓✓✓ = 10 + 10+15 + 0+10+10+15
    expect(await (await getSession(req("/api/session", { cookie: b }), inflated.deps)).json()).toMatchObject({ points: 70 });
  });

  it("answers 429 beyond the pace cap, adds nothing, and takes the batch once it fits", async () => {
    const { deps, state, advance } = setup();
    const cookie = await login(deps, "Ana");
    // A fresh session may save PACE_BURST answers at once, not one more.
    expect((await score(deps, cookie, { answers: new Array(PACE_BURST).fill(false) })).status).toBe(200);
    const send = () => submitScore(req("/api/score", { method: "POST", cookie, body: { batchId: "too-soon", answers: [true, true] } }), deps);
    const refused = await send();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("3"); // two answers at 1.5 s each
    expect(await refused.json()).toEqual({ error: "You're answering faster than points can be saved. Wait a moment and try again." });
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ points: 0 });
    expect(state.totals.size).toBe(0);

    advance(2 * PACE_MS_PER_ANSWER - 1);
    expect((await send()).status).toBe(429);
    advance(1);
    const saved = await send();
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ pointsEarned: 20, sessionPoints: 20 });
  });

  it("adds points and ranks students by total points across sessions", async () => {
    const { deps } = setup();
    const ana = await login(deps, "Ana");
    const ben = await login(deps, "Ben");

    const first = await score(deps, ana, { answers: [true, true, true] });
    expect(await first.json()).toMatchObject({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35 });

    await score(deps, ben, { answers: [true, false] });

    // A new session with the same name (any case) adds to the same total.
    const ana2 = await login(deps, "ana");
    const res = await score(deps, ana2, { answers: [true] });
    expect(await res.json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10, totalPoints: 45 });

    const mine = await (await getLeaderboard(req("/api/leaderboard", { cookie: ana2 }), deps)).json();
    expect(mine.top).toEqual([
      { rank: 1, name: "ana", points: 45 },
      { rank: 2, name: "Ben", points: 10 },
    ]);
    expect(mine.you).toEqual({ rank: 1, name: "ana", points: 45 });

    const board = await getLeaderboard(req("/api/leaderboard", { cookie: ben }), deps);
    expect((await board.json()).you).toEqual({ rank: 2, name: "Ben", points: 10 });
  });
});

describe("a profile session ends with its profile", () => {
  async function playing(showOnLeaderboard: boolean) {
    const ctx = setup();
    const made = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "Nova7", showOnLeaderboard } }), ctx.deps);
    const kid = (await made.json()).profile as { id: string };
    const start = await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId: kid.id } }), ctx.deps);
    expect(start.status).toBe(201);
    const cookie = cookieFrom(start);
    expect((await score(ctx.deps, cookie, { answers: [true, true] })).status).toBe(200);
    return { ...ctx, kid, cookie, key: `p:${kid.id}` };
  }

  /** Nothing is left of the player, and a save in the old session can't bring them back. */
  async function expectGone({ deps, state, cookie, key }: Awaited<ReturnType<typeof playing>>) {
    const late = await score(deps, cookie, { answers: [true, true, true] });
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual({ error: "Your session has ended. Start a new one to save points." });
    expect(await deps.store!.totalsFor([key])).toEqual({ [key]: 0 });
    expect(await deps.store!.leaderboard(10, key)).toEqual({ top: [], you: null });
    expect(state.names.has(key)).toBe(false);
    expect(state.hidden.has(key)).toBe(false);

    const session = await getSession(req("/api/session", { cookie }), deps);
    expect(await session.json()).toBeNull();
    expect(session.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await (await getLeaderboard(req("/api/leaderboard", { cookie }), deps)).json()).you).toBeNull();
  }

  it("a save after the profile is deleted is refused and recreates nothing", async () => {
    const game = await playing(true);
    expect((await game.deps.store!.leaderboard(10)).top).toEqual([{ rank: 1, name: "Nova7", points: 20 }]);
    expect((await deleteProfile(req(`/api/profiles?id=${game.kid.id}`, { method: "DELETE", user: "ana" }), game.deps)).status).toBe(200);
    await expectGone(game);
  });

  it("the same after the whole account is deleted", async () => {
    const game = await playing(true);
    expect((await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), game.deps)).status).toBe(200);
    await expectGone(game);
    // Signing in again starts an empty account; the old session still isn't theirs.
    await getMe(req("/api/me", { user: "ana" }), game.deps);
    expect((await score(game.deps, game.cookie, { answers: [true] })).status).toBe(401);
  });

  it("a profile kept off the board never appears on it this way", async () => {
    const game = await playing(false);
    expect((await game.deps.store!.leaderboard(10)).top).toEqual([]);
    await deleteProfile(req(`/api/profiles?id=${game.kid.id}`, { method: "DELETE", user: "ana" }), game.deps);
    await expectGone(game);
  });

  it("a profile session needs the accounts database to be checked against", async () => {
    const game = await playing(true);
    const noAccounts: Deps = { ...game.deps, accounts: null };
    expect((await score(noAccounts, game.cookie, { answers: [true] })).status).toBe(401);
    expect(await (await getSession(req("/api/session", { cookie: game.cookie }), noAccounts)).json()).toBeNull();
    expect(await game.deps.store!.totalsFor([game.key])).toEqual({ [game.key]: 20 });
  });
});

describe("requests from other sites and odd bodies", () => {
  it("refuses a text/plain or form POST to /api/session and /api/kid", async () => {
    const { deps } = setup();
    const token = "A".repeat(43);
    for (const type of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const start = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" }, headers: { "content-type": type } }), deps);
      expect(start.status, type).toBe(415);
      expect(start.headers.get("set-cookie")).toBeNull();
      const join = await postKid(req("/api/kid", { method: "POST", body: { action: "join", token }, headers: { "content-type": type } }), deps);
      expect(join.status, type).toBe(415);
    }
    // JSON with a charset is still JSON.
    const ok = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" }, headers: { "content-type": "application/json; charset=utf-8" } }), deps);
    expect(ok.status).toBe(201);
  });

  it("doesn't read a body that comes with no content type at all", async () => {
    // A page on another site can send bytes with no type without the browser asking first.
    const { deps, state } = setup();
    const untyped = (path: string, body: unknown, cookie?: string) =>
      new Request(`${BASE}${path}`, { method: "POST", headers: cookie ? { cookie } : {}, body: new TextEncoder().encode(JSON.stringify(body)) });
    expect(untyped("/api/session", {}).headers.has("content-type")).toBe(false);

    const start = await startSession(untyped("/api/session", { name: "Ana" }), deps);
    expect(start.status).toBe(400);
    expect(start.headers.get("set-cookie")).toBeNull();
    expect(state.sessions.size).toBe(0);

    const cookie = await login(deps, "Ana");
    const save = await submitScore(untyped("/api/score", { batchId: "b", answers: [true, true, true] }, cookie), deps);
    expect(save.status).toBe(400);
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ points: 0 });
  });

  it("refuses state-changing requests whose Origin isn't this site", async () => {
    const { deps } = setup();
    const start = (origin: string, extra: Record<string, string> = {}) =>
      startSession(req("/api/session", { method: "POST", body: { name: "Ana" }, headers: { origin, ...extra } }), deps);
    for (const origin of ["https://evil.example", "null", "http://localhost", "https://localhost:8443", "https://localhost.evil.example"]) {
      const res = await start(origin);
      expect(res.status, origin).toBe(403);
      expect(await res.json()).toEqual({ error: "This request came from another site." });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await start("https://localhost")).status).toBe(201);
    // Behind the platform's proxy, the public name arrives in headers.
    expect((await start("https://quizzlet.example", { "x-forwarded-host": "quizzlet.example", "x-forwarded-proto": "https" })).status).toBe(201);
    expect((await start("https://evil.example", { "x-forwarded-host": "quizzlet.example", "x-forwarded-proto": "https" })).status).toBe(403);

    const cookie = await login(deps, "Ana");
    const end = await endSession(req("/api/session", { method: "DELETE", cookie, headers: { origin: "https://evil.example" } }), deps);
    expect(end.status).toBe(403);
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ name: "Ana" });
    // Reading is not affected.
    expect((await getLeaderboard(req("/api/leaderboard", { headers: { origin: "https://evil.example" } }), deps)).status).toBe(200);
  });
});

describe("rate limits per address", () => {
  const from = (ip: string) => ({ "x-real-ip": ip });

  it("answers 429 over the limit, for that address and that route only", async () => {
    const { deps } = setup();
    const start = (ip: string, n: number) => startSession(req("/api/session", { method: "POST", body: { name: `Kid ${n}` }, headers: from(ip) }), deps);
    for (let n = 0; n < RATE_LIMITS.session.max; n++) expect((await start("203.0.113.7", n)).status).toBe(201);
    const over = await start("203.0.113.7", 999);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(over.headers.get("set-cookie")).toBeNull();

    expect((await start("203.0.113.8", 1)).status).toBe(201);
    expect((await getLeaderboard(req("/api/leaderboard", { headers: from("203.0.113.7") }), deps)).status).toBe(200);
  });

  it("starts counting again after the window", async () => {
    const { deps, advance } = setup();
    const board = () => getLeaderboard(req("/api/leaderboard", { headers: from("203.0.113.9") }), deps);
    for (let n = 0; n < RATE_LIMITS.leaderboard.max; n++) await board();
    expect((await board()).status).toBe(429);
    advance(RATE_LIMITS.leaderboard.windowSeconds * 1000);
    expect((await board()).status).toBe(200);
  });

  it("limits score saves and invitation links too", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    const save = () => submitScore(req("/api/score", { method: "POST", cookie, headers: from("203.0.113.10"), body: { batchId: "same", answers: [true] } }), deps);
    for (let n = 0; n < RATE_LIMITS.score.max; n++) await save();
    expect((await save()).status).toBe(429);

    const peek = () => postKid(req("/api/kid", { method: "POST", headers: from("203.0.113.10"), body: { action: "peek", token: "A".repeat(43) } }), deps);
    for (let n = 0; n < RATE_LIMITS.kid.max; n++) expect((await peek()).status).toBe(404);
    expect((await peek()).status).toBe(429);
  });

  it("doesn't limit where there is no address to count by (local development)", async () => {
    const { deps } = setup();
    for (let n = 0; n <= RATE_LIMITS.kid.max; n++) {
      expect((await postKid(req("/api/kid", { method: "POST", body: { action: "peek", token: "A".repeat(43) } }), deps)).status).toBe(404);
    }
  });

  it("lets requests through if the counter itself fails", async () => {
    const { deps } = setup();
    deps.store!.hit = async () => { throw new Error("redis down"); };
    expect((await getLeaderboard(req("/api/leaderboard", { headers: from("203.0.113.11") }), deps)).status).toBe(200);
  });
});

describe("storage", () => {
  it("uses memory locally, Redis when configured, and nothing on Vercel without Redis", () => {
    expect(getStore({})).toBeInstanceOf(MemoryStore);
    expect(getStore({ VERCEL: "1" })).toBeNull();
    expect(getStore({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })?.constructor.name).toBe("RedisStore");
  });

  it("never falls back to memory on Vercel or in a production build", () => {
    const stores = { score: getStore, accounts: getAccountsDb, files: getFileStore };
    for (const [name, get] of Object.entries(stores)) {
      for (const VERCEL of [undefined, "1"]) {
        for (const NODE_ENV of [undefined, "development", "test", "production"]) {
          const local = !VERCEL && NODE_ENV !== "production";
          expect(get({ VERCEL, NODE_ENV }) !== null, `${name} VERCEL=${VERCEL} NODE_ENV=${NODE_ENV}`).toBe(local);
        }
      }
    }
    // Real services are used wherever they are configured.
    expect(getStore({ NODE_ENV: "production", KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })).not.toBeNull();
    expect(getFileStore({ NODE_ENV: "production", BLOB_READ_WRITE_TOKEN: "t" })).not.toBeNull();
  });

  it("answers 503 when storage is missing", async () => {
    const deps: Deps = { store: null, now: () => 0, newId: () => "x" };
    const res = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps);
    expect(res.status).toBe(503);
  });
});

describe("idempotent score batches", () => {
  it("credits an identical concurrent replay once and rejects conflicting payloads", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Explorer");
    const send = (answers: boolean[]) => submitScore(req("/api/score", {
      method: "POST", cookie, body: { batchId: "batch-one", answers, streakBefore: 0, leaderboard: false },
    }), deps);
    const [first, replay] = await Promise.all([send([true]), send([true])]);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual(await replay.json());
    expect((await send([false])).status).toBe(409);
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ points: 10 });
  });
});

describe("score batch outcomes", () => {
  it("keeps an acknowledged score when the optional leaderboard is unavailable", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Explorer");
    deps.store!.leaderboard = async () => { throw new Error("board unavailable"); };
    const res = await submitScore(req("/api/score", { method: "POST", cookie, body: { batchId: "b1", answers: [true], leaderboard: true } }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10, leaderboard: null });
  });
  it("returns an identical receipt even when the public board changes", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Explorer");
    const body = { batchId: "with-board", answers: [true], leaderboard: true };
    const first = await (await submitScore(req("/api/score", { method: "POST", cookie, body }), deps)).json();
    const other = await login(deps, "Other");
    await score(deps, other, { answers: [true] });
    const replay = await (await submitScore(req("/api/score", { method: "POST", cookie, body }), deps)).json();
    expect(first).toEqual(replay);
    expect(first.leaderboard).toBeNull();
  });
  it("rejects a new batch after session expiry without scoring", async () => {
    const { deps, advance } = setup();
    const cookie = await login(deps, "Explorer");
    advance(3600 * 1000);
    expect((await submitScore(req("/api/score", { method: "POST", cookie, body: { batchId: "late", answers: [true], leaderboard: false } }), deps)).status).toBe(401);
    expect((await deps.store!.leaderboard(10)).top).toEqual([]);
  });
});

describe("score session binding", () => {
  it("rejects an old session batch sent with a different session cookie", async () => {
    const { deps } = setup();
    const first = await startSession(req("/api/session", { method: "POST", body: { name: "Alpha" } }), deps);
    const firstInfo = await first.json();
    const second = await startSession(req("/api/session", { method: "POST", body: { name: "Beta" } }), deps);
    const secondCookie = cookieFrom(second);
    const response = await submitScore(req("/api/score", { method: "POST", cookie: secondCookie, body: { batchId: "old-batch", sessionTag: firstInfo.sessionTag, answers: [true], leaderboard: false } }), deps);
    expect(response.status).toBe(409);
    expect(await (await getSession(req("/api/session", { cookie: secondCookie }), deps)).json()).toMatchObject({ points: 0 });
  });
});

describe("post-commit failure recovery", () => {
  it("returns the original receipt after the response is lost following a commit", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Explorer");
    const store = deps.store!;
    const save = store.addScoreBatch.bind(store);
    let lost = true;
    store.addScoreBatch = async (...args) => {
      const receipt = await save(...args);
      if (lost) { lost = false; throw new Error("connection lost after commit"); }
      return receipt;
    };
    const send = () => submitScore(req("/api/score", { method: "POST", cookie, body: { batchId: "lost-response", answers: [true], leaderboard: false } }), deps);
    await expect(send()).rejects.toThrow("connection lost after commit");
    expect(await (await send()).json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10 });
    expect(await (await getSession(req("/api/session", { cookie }), deps)).json()).toMatchObject({ points: 10 });
  });
});
