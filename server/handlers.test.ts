import { describe, expect, it } from "vitest";
import { pointsForAnswer, scoreRound } from "../src/points.js";
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
import { getStore, MemoryStore } from "./store.js";

const BASE = "https://quizzlet.test";

function setup() {
  let clock = Date.UTC(2026, 10, 7, 12, 0, 0);
  let ids = 0;
  const deps: Deps = { store: new MemoryStore(), now: () => clock, newId: () => `id-${++ids}` };
  return { deps, advance: (ms: number) => (clock += ms) };
}

function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
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
    expect(scoreRound([true, true, true, true, false, true])).toEqual({ points: 60, correct: 5, bestStreak: 4 });
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
      new Request("http://localhost:5173/api/session", { method: "POST", body: JSON.stringify({ name: "Ana" }) }),
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
    expect(expired.status).toBe(401);
    expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("401s without a cookie and ends a session on DELETE", async () => {
    const { deps } = setup();
    expect((await getSession(req("/api/session"), deps)).status).toBe(401);

    const cookie = await login(deps, "Ana");
    const res = await endSession(req("/api/session", { method: "DELETE", cookie }), deps);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await getSession(req("/api/session", { cookie }), deps)).status).toBe(401);
  });
});

describe("scores and leaderboard", () => {
  it("needs an active session", async () => {
    const { deps } = setup();
    const res = await submitScore(req("/api/score", { method: "POST", body: { answers: [true] } }), deps);
    expect(res.status).toBe(401);
  });

  it("validates the answers list", async () => {
    const { deps } = setup();
    const cookie = await login(deps, "Ana");
    for (const answers of [[], ["yes"], "true", new Array(201).fill(true)]) {
      const res = await submitScore(req("/api/score", { method: "POST", body: { answers }, cookie }), deps);
      expect(res.status).toBe(400);
    }
  });

  it("adds points and ranks students by total points across sessions", async () => {
    const { deps } = setup();
    const ana = await login(deps, "Ana");
    const ben = await login(deps, "Ben");

    const first = await submitScore(req("/api/score", { method: "POST", body: { answers: [true, true, true] }, cookie: ana }), deps);
    expect(await first.json()).toMatchObject({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35 });

    await submitScore(req("/api/score", { method: "POST", body: { answers: [true, false] }, cookie: ben }), deps);

    // A new session with the same name (any case) adds to the same total.
    const ana2 = await login(deps, "ana");
    const res = await submitScore(req("/api/score", { method: "POST", body: { answers: [true] }, cookie: ana2 }), deps);
    const body = await res.json();
    expect(body).toMatchObject({ pointsEarned: 10, sessionPoints: 10, totalPoints: 45 });
    expect(body.leaderboard.top).toEqual([
      { rank: 1, name: "ana", points: 45 },
      { rank: 2, name: "Ben", points: 10 },
    ]);
    expect(body.leaderboard.you).toEqual({ rank: 1, name: "ana", points: 45 });

    const board = await getLeaderboard(req("/api/leaderboard", { cookie: ben }), deps);
    expect((await board.json()).you).toEqual({ rank: 2, name: "Ben", points: 10 });
  });
});

describe("storage", () => {
  it("uses memory locally, Redis when configured, and nothing on Vercel without Redis", () => {
    expect(getStore({})).toBeInstanceOf(MemoryStore);
    expect(getStore({ VERCEL: "1" })).toBeNull();
    expect(getStore({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })?.constructor.name).toBe("RedisStore");
  });

  it("answers 503 when storage is missing", async () => {
    const deps: Deps = { store: null, now: () => 0, newId: () => "x" };
    const res = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps);
    expect(res.status).toBe(503);
  });
});
