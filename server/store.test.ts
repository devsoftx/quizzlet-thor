// The score store's rules, run against the in-memory store and, when a Redis
// is at hand, against RedisStore on a real Redis (through the same Upstash
// client production uses). Both must behave the same.
//
// The Redis runs need `redis-server` on the PATH, or QUIZZLET_TEST_REDIS=host:port
// pointing at a disposable Redis; without either they are skipped.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scoreRound } from "../src/points.js";
import { answersAllowed, MemoryStore, PACE_BURST, PACE_MS_PER_ANSWER, RedisStore, SESSION_TTL_SECONDS, type Session, type Store } from "./store.js";
import { redisAvailable, startTestRedis, type TestRedis } from "./test-support/redis.js";

const T0 = Date.UTC(2026, 10, 18, 12);
const HOUR = SESSION_TTL_SECONDS * 1000;

interface Harness {
  store: Store;
  /** playerKey -> stored display name. */
  names(): Promise<Record<string, string>>;
  /** Every player key with a leaderboard entry, even at 0 points. */
  boardKeys(): Promise<string[]>;
}

let ids = 0;
function guest(name: string, startedAt = T0): Session {
  return { id: `s-${++ids}`, name, playerKey: name.toLowerCase(), expiresAt: startedAt + HOUR, points: 0, listed: true };
}
function profile(id: string, name: string, listed: boolean, startedAt = T0): Session {
  return { id: `s-${++ids}`, name, playerKey: `p:${id}`, profileId: id, accountId: "acct", expiresAt: startedAt + HOUR, points: 0, listed };
}

let batches = 0;
const batch = (answers: boolean[], extra: { id?: string; fingerprint?: string; streakCap?: number } = {}) => ({
  id: extra.id ?? `b-${++batches}`,
  fingerprint: extra.fingerprint ?? JSON.stringify(answers),
  answers,
  ...(extra.streakCap === undefined ? {} : { streakCap: extra.streakCap }),
});

function rules(make: () => Harness) {
  let h: Harness;
  beforeEach(() => {
    h = make();
  });

  it("keeps sessions for their hour", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    expect(await h.store.getSession(session.id, T0 + HOUR - 1)).toMatchObject({ name: "Ana", playerKey: "ana", points: 0 });
    expect(await h.store.getSession(session.id, T0 + HOUR)).toBeNull();
    await h.store.deleteSession(session.id);
    expect(await h.store.getSession(session.id, T0)).toBeNull();
  });

  it("doesn't store a guest's name until they earn points", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    expect(await h.names()).toEqual({});
    expect(await h.boardKeys()).toEqual([]);

    // Wrong answers and a totals-only read leave no trace either.
    expect(await h.store.addScoreBatch(session, batch([false, false]), T0)).toEqual({ pointsEarned: 0, sessionPoints: 0, totalPoints: 0 });
    expect(await h.store.addScoreBatch(session, batch([]), T0)).toEqual({ pointsEarned: 0, sessionPoints: 0, totalPoints: 0 });
    expect(await h.names()).toEqual({});
    expect(await h.boardKeys()).toEqual([]);

    await h.store.addScoreBatch(session, batch([true]), T0);
    expect(await h.names()).toEqual({ ana: "Ana" });
    expect(await h.boardKeys()).toEqual(["ana"]);
  });

  it("keeps the streak itself, across batches", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    // ✓✓ then ✓✓ : 10+10, then 15+15 from the streak carried over.
    expect(await h.store.addScoreBatch(session, batch([true, true]), T0)).toEqual({ pointsEarned: 20, sessionPoints: 20, totalPoints: 20 });
    expect(await h.store.addScoreBatch(session, batch([true, true]), T0)).toEqual({ pointsEarned: 30, sessionPoints: 50, totalPoints: 50 });
    expect(scoreRound([true, true, true, true]).points).toBe(50);
    // A wrong answer ends it.
    expect(await h.store.addScoreBatch(session, batch([false, true]), T0)).toMatchObject({ pointsEarned: 10 });
    expect(await h.store.getSession(session.id, T0)).toMatchObject({ points: 60, streak: 1, answers: 6 });
  });

  it("lets the browser's streak lower its own, never raise it", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    // A claimed streak of 50 with none earned: no bonus.
    expect(await h.store.addScoreBatch(session, batch([true], { streakCap: 50 }), T0)).toMatchObject({ pointsEarned: 10 });
    await h.store.addScoreBatch(session, batch([true, true]), T0); // streak is now 3
    // A new round says 0: back to the start, no bonus.
    expect(await h.store.addScoreBatch(session, batch([true], { streakCap: 0 }), T0)).toMatchObject({ pointsEarned: 10 });
  });

  it("credits a batch once: a replay gets the first receipt, other answers a conflict", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    const first = batch([true, true, true], { id: "same" });
    const results = await Promise.all(Array.from({ length: 8 }, () => h.store.addScoreBatch(session, first, T0)));
    for (const result of results) expect(result).toEqual({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35 });
    expect(await h.store.addScoreBatch(session, batch([false], { id: "same" }), T0)).toBe("conflict");

    // More points later don't change what the replay is told.
    await h.store.addScoreBatch(session, batch([true]), T0);
    expect(await h.store.addScoreBatch(session, first, T0)).toEqual({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35 });
    expect(await h.store.getSession(session.id, T0)).toMatchObject({ points: 50, answers: 4 });
  });

  it("refuses new batches once the session is over, but still answers a replay", async () => {
    const session = guest("Ana");
    await h.store.createSession(session);
    const saved = batch([true], { id: "kept" });
    await h.store.addScoreBatch(session, saved, T0);
    expect(await h.store.addScoreBatch(session, batch([true]), T0 + HOUR)).toBe("expired");
    expect(await h.store.addScoreBatch(session, saved, T0 + HOUR)).toEqual({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10 });
    expect((await h.store.leaderboard(10)).top).toEqual([{ rank: 1, name: "Ana", points: 10 }]);
  });

  it("caps the pace: answers beyond what the session's age allows add nothing", async () => {
    expect(answersAllowed(0)).toBe(PACE_BURST);
    const session = guest("Ana");
    await h.store.createSession(session);
    const full = new Array<boolean>(PACE_BURST).fill(false);
    expect(await h.store.addScoreBatch(session, batch(full), T0)).not.toBe("too-fast");
    // One more right away is over the cap, and changes nothing.
    const extra = batch([true], { id: "extra" });
    expect(await h.store.addScoreBatch(session, extra, T0)).toBe("too-fast");
    expect(await h.store.addScoreBatch(session, extra, T0 + PACE_MS_PER_ANSWER - 1)).toBe("too-fast");
    expect(await h.store.getSession(session.id, T0)).toMatchObject({ points: 0, answers: PACE_BURST });
    expect(await h.boardKeys()).toEqual([]);
    // The same batch fits once enough time has passed.
    expect(await h.store.addScoreBatch(session, extra, T0 + PACE_MS_PER_ANSWER)).toEqual({ pointsEarned: 10, sessionPoints: 10, totalPoints: 10 });
    // A big batch must wait for its whole size.
    expect(await h.store.addScoreBatch(session, batch(new Array<boolean>(10).fill(true)), T0 + 5 * PACE_MS_PER_ANSWER)).toBe("too-fast");
    // Reading the totals is never throttled.
    expect(await h.store.addScoreBatch(session, batch([]), T0 + PACE_MS_PER_ANSWER)).toMatchObject({ sessionPoints: 10 });
  });

  it("adds a guest's sessions together and ranks the board", async () => {
    const ana = guest("Ana");
    const ben = guest("Ben");
    const anaAgain = guest("ana");
    for (const session of [ana, ben, anaAgain]) await h.store.createSession(session);
    await h.store.addScoreBatch(ana, batch([true, true, true]), T0);
    await h.store.addScoreBatch(ben, batch([true]), T0);
    expect(await h.store.addScoreBatch(anaAgain, batch([true]), T0)).toEqual({ pointsEarned: 10, sessionPoints: 10, totalPoints: 45 });
    expect(await h.store.leaderboard(10, "ben")).toEqual({
      top: [
        { rank: 1, name: "ana", points: 45 },
        { rank: 2, name: "Ben", points: 10 },
      ],
      you: { rank: 2, name: "Ben", points: 10 },
    });
    expect((await h.store.leaderboard(1, "nobody")).top).toHaveLength(1);
  });

  it("keeps a hidden profile's points off the board until the parent lists it", async () => {
    const nova = profile("k1", "Nova7", false);
    await h.store.createSession(nova);
    expect(await h.store.addScoreBatch(nova, batch([true, true]), T0)).toEqual({ pointsEarned: 20, sessionPoints: 20, totalPoints: 20 });
    expect(await h.store.leaderboard(10, "p:k1")).toEqual({ top: [], you: null });
    expect(await h.store.totalsFor(["p:k1", "p:none"])).toEqual({ "p:k1": 20, "p:none": 0 });

    await h.store.syncPlayer("p:k1", "Nova", true);
    expect((await h.store.leaderboard(10)).top).toEqual([{ rank: 1, name: "Nova", points: 20 }]);
    await h.store.syncPlayer("p:k1", "Nova", false);
    await h.store.addScoreBatch(nova, batch([true]), T0);
    expect((await h.store.leaderboard(10)).top).toEqual([]);
    expect(await h.store.totalsFor(["p:k1"])).toEqual({ "p:k1": 35 });
  });

  it("removes a player's name, total and board entry", async () => {
    const nova = profile("k2", "Nova7", true);
    const ana = guest("Ana");
    for (const session of [nova, ana]) {
      await h.store.createSession(session);
      await h.store.addScoreBatch(session, batch([true]), T0);
    }
    await h.store.removePlayer("p:k2");
    await h.store.removePlayer("ana");
    expect(await h.store.leaderboard(10)).toEqual({ top: [], you: null });
    expect(await h.store.totalsFor(["p:k2"])).toEqual({ "p:k2": 0 });
    expect(await h.names()).toEqual({});
  });

  it("counts requests per time window", async () => {
    expect(await h.store.hit("session:ip-a", 60_000, T0)).toMatchObject({ count: 1 });
    expect(await h.store.hit("session:ip-a", 60_000, T0 + 1)).toMatchObject({ count: 2 });
    expect(await h.store.hit("session:ip-b", 60_000, T0)).toMatchObject({ count: 1 });
    const third = await h.store.hit("session:ip-a", 60_000, T0 + 2);
    expect(third.count).toBe(3);
    expect(third.resetAt).toBeGreaterThan(T0);
    expect(third.resetAt).toBeLessThanOrEqual(T0 + 2 + 60_000);
  });
}

describe("memory store", () => {
  rules(() => {
    const state = { sessions: new Map(), totals: new Map<string, number>(), names: new Map<string, string>(), hidden: new Set<string>() };
    return {
      store: new MemoryStore(state),
      names: async () => Object.fromEntries(state.names),
      boardKeys: async () => [...state.totals.keys()].filter((key) => !state.hidden.has(key)).sort(),
    };
  });

  it("starts a new rate-limit window when the old one is over", async () => {
    const store = new MemoryStore();
    await store.hit("k", 1000, T0);
    expect(await store.hit("k", 1000, T0 + 999)).toMatchObject({ count: 2 });
    expect(await store.hit("k", 1000, T0 + 1000)).toEqual({ count: 1, resetAt: T0 + 2000 });
  });
});

describe.skipIf(!redisAvailable)("Redis store (a real Redis)", () => {
  let server: TestRedis;
  beforeAll(async () => {
    server = await startTestRedis();
  });
  afterAll(async () => {
    await server?.stop();
  });
  beforeEach(async () => {
    await server.flush();
  });

  rules(() => ({
    store: new RedisStore(server.redis),
    names: async () => {
      const names = await server.redis.hgetall<Record<string, unknown>>("player-names");
      return Object.fromEntries(Object.entries(names ?? {}).map(([key, name]) => [key, String(name)]));
    },
    boardKeys: async () => (await server.redis.zrange<string[]>("leaderboard", 0, -1)).map(String).sort(),
  }));

  it("lets the session, the rate counters and the receipts expire on their own", async () => {
    const store = new RedisStore(server.redis);
    const session = guest("Ana", Date.now());
    await store.createSession(session);
    await store.addScoreBatch(session, batch([true], { id: "ttl" }), Date.now());
    await store.hit("session:ip", 60_000, Date.now());
    for (const key of [`session:${session.id}`, `score-receipt:${session.id}:ttl`, "rate:session:ip"]) {
      expect(await server.redis.pttl(key), key).toBeGreaterThan(0);
    }
    // Saving points doesn't push the session's end back.
    expect(await server.redis.pttl(`session:${session.id}`)).toBeLessThanOrEqual(HOUR);
  });

  it("refuses to score when a key holds the wrong kind of value, and changes nothing", async () => {
    const store = new RedisStore(server.redis);
    const session = guest("Ana");
    await store.createSession(session);
    await server.redis.set("player-names", "not-a-hash");
    await expect(store.addScoreBatch(session, batch([true]), T0)).rejects.toThrow("Score storage is unavailable or invalid.");
    expect(await store.getSession(session.id, T0)).toMatchObject({ points: 0, answers: 0 });
  });

  it("still scores a session and replays a receipt written before the streak moved to the store", async () => {
    const store = new RedisStore(server.redis);
    // As the previous version wrote them: no streak or answer count, no pointsEarned in the receipt.
    await server.redis.hset("session:old", { name: "Ana", playerKey: "ana", expiresAt: T0 + HOUR, points: 20, profileId: "", listed: 1 });
    await server.redis.zadd("leaderboard", { score: 20, member: "ana" });
    await server.redis.set("score-receipt:old:before", JSON.stringify({ fingerprint: "fp", sessionPoints: 20, totalPoints: 20 }));
    const session = (await store.getSession("old", T0))!;
    expect(session).toMatchObject({ points: 20, streak: 0, answers: 0 });
    expect(await store.addScoreBatch(session, batch([true], { id: "before", fingerprint: "fp" }), T0)).toEqual({ pointsEarned: 0, sessionPoints: 20, totalPoints: 20 });
    expect(await store.addScoreBatch(session, batch([true]), T0)).toEqual({ pointsEarned: 10, sessionPoints: 30, totalPoints: 30 });
  });
});
