import { describe, expect, it } from "vitest";
import { pointsForAnswer, scoreRound } from "../src/points.js";
import {
  cleanName,
  type Deps,
  endSession,
  getLeaderboard,
  getSession,
  GUEST_COOKIE,
  SESSION_COOKIE,
  startSession,
  submitScore,
} from "./handlers.js";
import { getStore, MemoryStore, PACE_BURST, PACE_MS_PER_ANSWER } from "./store.js";
import { captureLog, cookieNamed, playing, score, type Playing } from "./test-support.js";

const BASE = "https://localhost";

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

/** Starts a guest session; `browser` is the cookie jar of a browser that has played before. */
async function play(deps: Deps, name: string, browser = ""): Promise<Playing> {
  const res = await startSession(req("/api/session", { method: "POST", body: { name }, cookie: browser || undefined }), deps);
  expect(res.status).toBe(201);
  return playing(res);
}

const board = async (deps: Deps, cookie?: string) => (await getLeaderboard(req("/api/leaderboard", { cookie }), deps)).json();
const sessionPoints = async (deps: Deps, who: Playing) => (await (await getSession(req("/api/session", { cookie: who.cookie }), deps)).json()).points;

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

describe("sessions", () => {
  it("starts a 60-minute session with a secure HttpOnly cookie", async () => {
    const { deps } = setup();
    const res = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps);
    expect(res.status).toBe(201);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
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
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("answers a malformed session cookie like no cookie at all, not with an error", async () => {
    const { deps } = setup();
    const res = await getSession(req("/api/session", { cookie: `${SESSION_COOKIE}=%E0%A4%A` }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    const scored = await submitScore(req("/api/score", { method: "POST", cookie: `${SESSION_COOKIE}=%E0%A4%A`, body: { answers: [true] } }), deps);
    expect(scored.status).toBe(401);
  });

  it("only reads a JSON body: a form posted as text/plain starts nothing", async () => {
    const { deps } = setup();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      const res = await startSession(
        new Request(`${BASE}/api/session`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify({ name: "Ana" }) }),
        deps,
      );
      expect(res.status, type).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
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
});

describe("scores and leaderboard", () => {
  it("needs an active session", async () => {
    const { deps } = setup();
    const res = await score(deps, { cookie: "", sessionTag: "none" }, { answers: [true] });
    expect(res.status).toBe(401);
  });

  it("validates the answers list", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    for (const answers of [[], ["yes"], "true", new Array(201).fill(true)]) {
      expect((await score(deps, ana, { answers })).status).toBe(400);
    }
  });

  it("needs the session's tag and a batch id on every save", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    const raw = (body: Record<string, unknown>) => submitScore(req("/api/score", { method: "POST", cookie: ana.cookie, body }), deps);
    expect((await raw({ answers: [true], batchId: "b1" })).status).toBe(400); // no session tag (an out-of-date page)
    expect((await raw({ answers: [true], sessionTag: ana.sessionTag })).status).toBe(400); // no batch id
    expect((await raw({ answers: [true], sessionTag: ana.sessionTag, batchId: "bad id!" })).status).toBe(400);
    expect(await sessionPoints(deps, ana)).toBe(0);
    expect((await raw({ answers: [true], sessionTag: ana.sessionTag, batchId: "b1" })).status).toBe(200);
    expect(await sessionPoints(deps, ana)).toBe(10);
  });

  it("saves a round in pieces with the same points as all at once", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    const piece = async (body: Record<string, unknown>) => (await score(deps, ana, body)).json();

    // true, true (20) then true with the streak carried over (10 + 5 bonus): 35, like [true, true, true].
    expect(await piece({ answers: [true, true], streakBefore: 0 })).toMatchObject({ pointsEarned: 20, sessionPoints: 20, leaderboard: null });
    expect(await piece({ answers: [true], streakBefore: 2 })).toMatchObject({ pointsEarned: 15, sessionPoints: 35 });
    expect(scoreRound([true, true, true]).points).toBe(35);

    // Nothing left to send: an empty list may ask for the totals.
    expect(await piece({ answers: [], leaderboard: true })).toMatchObject({ pointsEarned: 0, sessionPoints: 35, totalPoints: 35 });
    expect((await board(deps)).top).toEqual([{ rank: 1, name: "Ana", points: 35 }]);

    for (const streakBefore of [-1, 1.5, "2", 201]) {
      expect((await score(deps, ana, { answers: [true], streakBefore })).status).toBe(400);
    }
  });

  it("adds points and ranks students by total points across sessions", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    const ben = await play(deps, "Ben");

    expect(await (await score(deps, ana, { answers: [true, true, true] })).json()).toMatchObject({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35 });
    await score(deps, ben, { answers: [true, false] });

    // A new session in the same browser with the same name (any case) adds to the same total.
    const ana2 = await play(deps, "ana", ana.cookie);
    expect(await (await score(deps, ana2, { answers: [true] })).json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10, totalPoints: 45 });

    const seen = await board(deps, ana2.cookie);
    expect(seen.top).toEqual([
      { rank: 1, name: "ana", points: 45 },
      { rank: 2, name: "Ben", points: 10 },
    ]);
    expect(seen.you).toEqual({ rank: 1, name: "ana", points: 45 });
    expect((await board(deps, ben.cookie)).you).toEqual({ rank: 2, name: "Ben", points: 10 });
  });

  it("keeps a guest who never scored out of the stored names and off the board", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [false, false] });
    expect(await board(deps, ana.cookie)).toEqual({ top: [], you: null });
  });
});

describe("the server keeps the streak (the browser can't claim one)", () => {
  it("gives a forged streakBefore no bonus", async () => {
    const { deps } = setup();
    const honest = await play(deps, "Honest");
    const forger = await play(deps, "Forger");
    const fair = await (await score(deps, honest, { answers: [true] })).json();
    const forged = await (await score(deps, forger, { answers: [true], streakBefore: 200 })).json();
    expect(forged.pointsEarned).toBe(fair.pointsEarned);
    expect(forged).toMatchObject({ pointsEarned: 10, sessionPoints: 10 });
  });

  it("carries the real streak over even when the browser says nothing", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true, true] });
    expect(await (await score(deps, ana, { answers: [true] })).json()).toMatchObject({ pointsEarned: 15 }); // third in a row
  });

  it("lets a new round start over from zero, but never raises the streak", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true, true, true] }); // streak 3
    expect(await (await score(deps, ana, { answers: [true], streakBefore: 0 })).json()).toMatchObject({ pointsEarned: 10 }); // new round
    expect(await (await score(deps, ana, { answers: [true], streakBefore: 50 })).json()).toMatchObject({ pointsEarned: 10 }); // really on 1
    expect(await (await score(deps, ana, { answers: [true], streakBefore: 2 })).json()).toMatchObject({ pointsEarned: 15 }); // and now on 2
  });

  it("a wrong answer ends the stored streak", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true, true, true, false] });
    expect(await (await score(deps, ana, { answers: [true], streakBefore: 3 })).json()).toMatchObject({ pointsEarned: 10 });
  });
});

describe("pace limit", () => {
  it("refuses answers that arrive faster than a person can give them, and saves nothing", async () => {
    const { deps, advance } = setup();
    const ana = await play(deps, "Ana");
    const burst = new Array(PACE_BURST).fill(false);
    expect((await score(deps, ana, { answers: burst })).status).toBe(200);

    const tooFast = await score(deps, ana, { answers: [true], batchId: "fast" });
    expect(tooFast.status).toBe(429);
    expect(await sessionPoints(deps, ana)).toBe(0);
    expect((await board(deps)).top).toEqual([]);

    // The same batch goes through once time has caught up (one answer per 2 seconds).
    advance(PACE_MS_PER_ANSWER);
    expect((await score(deps, ana, { answers: [true], batchId: "fast" })).status).toBe(200);
    expect((await score(deps, ana, { answers: [true] })).status).toBe(429);
    expect(await sessionPoints(deps, ana)).toBe(10);
  });

  it("holds the review's forged-points run to the pace limit", async () => {
    // The review minted 60,000 points with 20 requests of 200 "correct" answers and streakBefore: 200.
    const { deps } = setup();
    const forger = await play(deps, "Forger");
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      statuses.push((await score(deps, forger, { answers: new Array(200).fill(true), streakBefore: 200 })).status);
    }
    expect(statuses.every((s) => s === 429)).toBe(true);
    expect(await sessionPoints(deps, forger)).toBe(0);
    // What is allowed right away is the burst, scored from a real streak of zero.
    const allowed = await (await score(deps, forger, { answers: new Array(PACE_BURST).fill(true), streakBefore: 200 })).json();
    expect(allowed.pointsEarned).toBe(scoreRound(new Array(PACE_BURST).fill(true)).points);
  });

  it("starting a new session doesn't start a new allowance", async () => {
    const { deps, advance } = setup();
    const first = await play(deps, "Cycler");
    expect((await score(deps, first, { answers: new Array(PACE_BURST).fill(true) })).status).toBe(200);
    const total = await sessionPoints(deps, first);

    // Session after session from the same browser, each trying its own "first 20 answers".
    let cookie = first.cookie;
    for (let i = 0; i < 5; i++) {
      const next = await play(deps, "Cycler", cookie);
      cookie = next.cookie;
      expect((await score(deps, next, { answers: new Array(PACE_BURST).fill(true) })).status).toBe(429);
      expect((await score(deps, next, { answers: [true] })).status).toBe(429);
    }
    expect((await board(deps)).top).toEqual([{ rank: 1, name: "Cycler", points: total }]);

    // Time still earns answers at the usual pace, in whichever session is current.
    advance(3 * PACE_MS_PER_ANSWER);
    const later = await play(deps, "Cycler", cookie);
    expect((await score(deps, later, { answers: [true, true, true] })).status).toBe(200);
    expect((await score(deps, later, { answers: [true] })).status).toBe(429);
  });

  it("gives each player their own allowance", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    const ben = await play(deps, "Ben");
    expect((await score(deps, ana, { answers: new Array(PACE_BURST).fill(true) })).status).toBe(200);
    expect((await score(deps, ben, { answers: new Array(PACE_BURST).fill(true) })).status).toBe(200);
  });

  it("always answers a request for the totals", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: new Array(PACE_BURST).fill(true) });
    expect((await score(deps, ana, { answers: [], leaderboard: true })).status).toBe(200);
  });
});

describe("guest nicknames belong to one browser", () => {
  it("gives the browser a long-lived HttpOnly id and refuses the name to another browser", async () => {
    const { deps } = setup();
    const first = await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps);
    const guest = first.headers.getSetCookie().find((c) => c.startsWith(`${GUEST_COOKIE}=`))!;
    expect(guest).toMatch(new RegExp(`^${GUEST_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$`));

    // Another browser (no cookie, or a different one) can't take over the row, in any letter case.
    for (const cookie of [undefined, `${GUEST_COOKIE}=${"x".repeat(43)}`, `${GUEST_COOKIE}=not-a-secret`]) {
      const other = await startSession(req("/api/session", { method: "POST", body: { name: "ANA" }, cookie }), deps);
      expect(other.status).toBe(409);
      expect(await other.json()).toEqual({ error: "That nickname is taken. Please pick another one." });
      expect(other.headers.get("set-cookie")).toBeNull();
    }

    // The same browser keeps its name and its id.
    const again = await startSession(req("/api/session", { method: "POST", body: { name: "ana" }, cookie: cookieNamed(first, GUEST_COOKIE) }), deps);
    expect(again.status).toBe(201);
    expect(cookieNamed(again, GUEST_COOKIE)).toBe(cookieNamed(first, GUEST_COOKIE));
  });

  it("frees a nickname 30 days after its browser last used it", async () => {
    const { deps, advance } = setup();
    await play(deps, "Ana");
    advance(29 * 24 * 60 * 60 * 1000);
    expect((await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps)).status).toBe(409);
    advance(2 * 24 * 60 * 60 * 1000);
    expect((await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps)).status).toBe(201);
  });

  it("keeps nicknames that look like numbers apart (42 is not 42.0)", async () => {
    const { deps } = setup();
    const a = await play(deps, "42");
    const b = await play(deps, "42.0"); // another browser, another nickname: allowed, and a separate row
    await score(deps, a, { answers: [true, true] });
    await score(deps, b, { answers: [true] });
    expect((await board(deps, b.cookie))).toEqual({
      top: [
        { rank: 1, name: "42", points: 20 },
        { rank: 2, name: "42.0", points: 10 },
      ],
      you: { rank: 2, name: "42.0", points: 10 },
    });
    // Odd but valid nicknames keep working as sessions.
    for (const name of ["0", "true", "null"]) {
      const who = await play(deps, name);
      expect(await sessionPoints(deps, who)).toBe(0);
    }
  });

  it("two browsers can't add to the same leaderboard row", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true] });
    expect((await startSession(req("/api/session", { method: "POST", body: { name: "Ana" } }), deps)).status).toBe(409);
    expect((await board(deps)).top).toEqual([{ rank: 1, name: "Ana", points: 10 }]);
  });
});

describe("leaderboard switch and blocked nicknames", () => {
  it("shows an empty board while it's switched off, and still saves points", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true] });
    deps.flags = async () => ({ enabled: false, blockedNames: [] });
    expect(await board(deps, ana.cookie)).toEqual({ top: [], you: null });
    expect(await (await score(deps, ana, { answers: [true] })).json()).toMatchObject({ sessionPoints: 20, totalPoints: 20 });
    deps.flags = async () => ({ enabled: true, blockedNames: [] });
    expect((await board(deps)).top).toEqual([{ rank: 1, name: "Ana", points: 20 }]);
  });

  it("refuses a guest nickname that contains a blocked entry", async () => {
    const { deps } = setup();
    deps.flags = async () => ({ enabled: true, blockedNames: ["badword"] });
    for (const name of ["badword", "BadWord 7", "x-B.a.d w'o-rd-x"]) {
      const res = await startSession(req("/api/session", { method: "POST", body: { name } }), deps);
      expect(res.status, name).toBe(400);
      expect(await res.json()).toEqual({ error: "Please choose a different nickname." });
    }
    expect((await startSession(req("/api/session", { method: "POST", body: { name: "Good name" } }), deps)).status).toBe(201);
  });

  it("refuses a nickname with a built-in blocked word or look-alike letters, with no operator list at all", async () => {
    const { deps } = setup();
    const log = captureLog();
    try {
      const start = (name: string) => startSession(req("/api/session", { method: "POST", body: { name } }), deps);

      const blocked = await start("Sh1thead");
      expect(blocked.status).toBe(400);
      expect(await blocked.json()).toEqual({ error: "Please choose a different nickname." });
      expect(blocked.headers.get("set-cookie")).toBeNull();

      // "Аna" with a Cyrillic А would sit on the board looking like "Ana".
      const lookalike = await start("\u0410na");
      expect(lookalike.status).toBe(400);
      expect(await lookalike.json()).toEqual({ error: "Please use letters from one alphabet in your nickname." });

      expect((await start("Ana")).status).toBe(201);
      // Logged like the operator's list, and never with the nickname itself.
      expect(log.named("session.name_blocked")).toHaveLength(1);
      expect(log.lines.join("\n")).not.toMatch(/sh1thead/i);
    } finally {
      log.restore();
    }
  });

  it("keeps a removed nickname off the board even if it's played again", async () => {
    const { deps } = setup();
    const ana = await play(deps, "Ana");
    await score(deps, ana, { answers: [true] });
    await deps.store!.removePlayer("ana"); // what scripts/leaderboard-remove.mjs does
    expect((await board(deps)).top).toEqual([]);
    const back = await play(deps, "Ana");
    expect(await (await score(deps, back, { answers: [true, true] })).json()).toMatchObject({ pointsEarned: 20, sessionPoints: 20 });
    expect(await board(deps, back.cookie)).toEqual({ top: [], you: null });
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

describe("idempotent score batches", () => {
  it("credits an identical concurrent replay once and rejects conflicting payloads", async () => {
    const { deps } = setup();
    const who = await play(deps, "Explorer");
    const send = (answers: boolean[]) => score(deps, who, { batchId: "batch-one", answers, streakBefore: 0 });
    const [first, replay] = await Promise.all([send([true]), send([true])]);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual(await replay.json());
    expect((await send([false])).status).toBe(409);
    expect(await sessionPoints(deps, who)).toBe(10);
  });

  it("replays the original receipt, with the points it earned at the time", async () => {
    const { deps } = setup();
    const who = await play(deps, "Explorer");
    await score(deps, who, { answers: [true, true] });
    const body = { batchId: "third", answers: [true] };
    const first = await (await score(deps, who, body)).json();
    expect(first).toMatchObject({ pointsEarned: 15, sessionPoints: 35 });
    await score(deps, who, { answers: [false] }); // the streak is gone now
    expect(await (await score(deps, who, body)).json()).toEqual(first);
    expect(await sessionPoints(deps, who)).toBe(35);
  });
});

describe("score batch outcomes", () => {
  it("returns an identical receipt even when the public board changes", async () => {
    const { deps } = setup();
    const who = await play(deps, "Explorer");
    const body = { batchId: "with-board", answers: [true], leaderboard: true };
    const first = await (await score(deps, who, body)).json();
    const other = await play(deps, "Other");
    await score(deps, other, { answers: [true] });
    const replay = await (await score(deps, who, body)).json();
    expect(first).toEqual(replay);
    expect(first.leaderboard).toBeNull();
  });
  it("rejects a new batch after session expiry without scoring", async () => {
    const { deps, advance } = setup();
    const who = await play(deps, "Explorer");
    advance(3600 * 1000);
    expect((await score(deps, who, { batchId: "late", answers: [true] })).status).toBe(401);
    expect((await deps.store!.leaderboard(10)).top).toEqual([]);
  });
});

describe("score session binding", () => {
  it("rejects an old session batch sent with a different session cookie", async () => {
    const { deps } = setup();
    const first = await play(deps, "Alpha");
    const second = await play(deps, "Beta");
    const response = await score(deps, { cookie: second.cookie, sessionTag: first.sessionTag }, { batchId: "old-batch", answers: [true] });
    expect(response.status).toBe(409);
    expect(await sessionPoints(deps, second)).toBe(0);
  });
});

describe("post-commit failure recovery", () => {
  it("returns the original receipt after the response is lost following a commit", async () => {
    const { deps } = setup();
    const who = await play(deps, "Explorer");
    const store = deps.store!;
    const save = store.addScoreBatch.bind(store);
    let lost = true;
    store.addScoreBatch = async (...args) => {
      const receipt = await save(...args);
      if (lost) { lost = false; throw new Error("connection lost after commit"); }
      return receipt;
    };
    const send = () => score(deps, who, { batchId: "lost-response", answers: [true] });
    await expect(send()).rejects.toThrow("connection lost after commit");
    expect(await (await send()).json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10 });
    expect(await sessionPoints(deps, who)).toBe(10);
  });
});
