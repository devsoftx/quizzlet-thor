// The Redis store against the memory store: the same scenario must come out
// the same from both.
//
// The memory half always runs. The Redis half needs a disposable Redis behind
// an Upstash-compatible REST endpoint (for example a local Redis with the
// serverless-redis-http container in front, or a dedicated test database):
//
//   QUIZZLET_DISPOSABLE_REDIS=1 QUIZZLET_TEST_REDIS_URL=http://127.0.0.1:8079 \
//   QUIZZLET_TEST_REDIS_TOKEN=local npm test -- server/store.redis.test.ts
//
// It runs FLUSHALL first, so it never reads the app's normal Upstash settings.

import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { MemoryStore, PACE_BURST, PACE_MS_PER_ANSWER, PROFILE_PACE_SCALE, RedisStore, SESSION_TTL_SECONDS, type Session, type Store } from "./store.js";

const redisUrl = process.env.QUIZZLET_DISPOSABLE_REDIS === "1" ? process.env.QUIZZLET_TEST_REDIS_URL : undefined;
const redisToken = process.env.QUIZZLET_TEST_REDIS_TOKEN ?? "local";

const HOUR = SESSION_TTL_SECONDS * 1000;

/** Everything observed while using a store the way the handlers do. */
async function scenario(store: Store) {
  const seen: Record<string, unknown> = {};
  // Real time: Redis expires keys by its own clock, whatever `now` the store is given.
  const now = Date.now();
  let ids = 0;
  const session = (player: Pick<Session, "name" | "playerKey" | "profileId" | "listed" | "emoji" | "accountId">, startedAt = now): Session => ({
    id: `scenario-${++ids}`,
    ...player,
    expiresAt: startedAt + HOUR,
    points: 0,
  });
  const batch = (id: string, answers: boolean[], streakBefore?: number) => ({ id, fingerprint: JSON.stringify([answers, streakBefore ?? null]), answers, streakBefore });
  const stored = async (s: Session) => {
    const found = await store.getSession(s.id, now);
    return found && { ...found, expiresAt: found.expiresAt - now };
  };

  // --- Sessions
  const guest = session({ name: "Ana María", playerKey: "ana maría", listed: true });
  const listedKid = session({ name: "Nova7", playerKey: "p:nova", profileId: "nova", listed: true, emoji: "🦊", accountId: "acct-1" });
  const privateKid = session({ name: "Secret Kid", playerKey: "p:secret", profileId: "secret", listed: false, emoji: "🐼", accountId: "acct-1" });
  for (const s of [guest, listedKid, privateKid]) await store.createSession(s);
  seen.guestSession = await stored(guest);
  seen.kidSession = await stored(listedKid);
  seen.privateSession = await stored(privateKid);
  seen.unknownSession = await store.getSession("no-such-session", now);
  const brief = session({ name: "Brief", playerKey: "brief", listed: true });
  await store.createSession(brief);
  seen.sessionAfterItsHour = await store.getSession(brief.id, brief.expiresAt);
  seen.boardBeforeAnyPoints = await store.leaderboard(10, guest.playerKey);

  // --- Scoring: the streak and the answer count live in the session
  seen.first = await store.addScoreBatch(guest, batch("b1", [true, true]), now);
  seen.forgedStreak = await store.addScoreBatch(guest, batch("b2", [false, true], 200), now); // really on 0 after the wrong answer
  seen.carried = await store.addScoreBatch(guest, batch("b3", [true, true]), now); // 2 and 3 in a row: one bonus
  seen.newRound = await store.addScoreBatch(guest, batch("b4", [true], 0), now);
  seen.replay = await store.addScoreBatch(guest, batch("b3", [true, true]), now);
  seen.conflict = await store.addScoreBatch(guest, batch("b3", [false]), now);
  seen.totals = await store.addScoreBatch(guest, batch("b5", []), now);
  seen.guestAfterScoring = await stored(guest);

  // --- Pace limit: nothing over the burst until time has passed
  const fast = session({ name: "Speedy", playerKey: "speedy", listed: true });
  await store.createSession(fast);
  seen.burst = await store.addScoreBatch(fast, batch("burst", new Array(PACE_BURST).fill(false)), now);
  seen.tooFast = await store.addScoreBatch(fast, batch("more", [true]), now);
  seen.afterWaiting = await store.addScoreBatch(fast, batch("more", [true]), now + PACE_MS_PER_ANSWER);
  seen.tooFastAgain = await store.addScoreBatch(fast, batch("again", [true, true]), now + PACE_MS_PER_ANSWER);
  seen.hugeBatch = await store.addScoreBatch(fast, batch("huge", new Array(200).fill(true), 200), now + PACE_MS_PER_ANSWER);
  // A new session isn't a new allowance: the player's answers are counted across sessions.
  const fastAgain = session({ name: "Speedy", playerKey: "speedy", listed: true }, now + PACE_MS_PER_ANSWER);
  await store.createSession(fastAgain);
  seen.newSessionSameLimit = await store.addScoreBatch(fastAgain, batch("s2", [true]), now + PACE_MS_PER_ANSWER);
  seen.newSessionAfterWaiting = await store.addScoreBatch(fastAgain, batch("s2", [false]), now + 2 * PACE_MS_PER_ANSWER);
  seen.expired = await store.addScoreBatch(fast, batch("late", [true]), fast.expiresAt);
  // A kid profile may be on several devices at once: each session has the usual limit,
  // and together they get that many times the allowance, no more.
  const busyKid = () => session({ name: "Busy", playerKey: "p:busy", profileId: "busy", listed: false, emoji: "🐙", accountId: "acct-1" });
  const devices: string[] = [];
  for (let d = 0; d < PROFILE_PACE_SCALE + 1; d++) {
    const s = busyKid();
    await store.createSession(s);
    const result = await store.addScoreBatch(s, batch(`d${d}`, new Array(PACE_BURST).fill(false)), now);
    devices.push(typeof result === "string" ? result : "ok");
  }
  seen.kidDevices = devices;

  // --- Nicknames that look like numbers or JSON stay themselves, and stay apart
  const odd: Record<string, unknown> = {};
  for (const name of ["42", "42.0", "1e3", "0", "true", "null", "007"]) {
    const s = session({ name, playerKey: name, listed: true });
    await store.createSession(s);
    const back = await store.getSession(s.id, now);
    const scored = await store.addScoreBatch(back ?? s, batch("n", name === "42" ? [true, true] : [true]), now);
    odd[name] = { name: back?.name, playerKey: back?.playerKey, total: typeof scored === "string" ? scored : scored.totalPoints };
  }
  seen.oddNames = odd;
  seen.oddNamesOnBoard = (await store.leaderboard(50, "42.0")).top.filter((e) => Object.keys(odd).includes(e.name)).map((e) => `${e.name}=${e.points}`).sort();
  seen.oddYou = (await store.leaderboard(50, "42.0")).you;
  for (const name of Object.keys(odd)) await store.removePlayer(name);

  // --- Kid profiles: totals are private, the board follows the parent's choice
  seen.kidScore = await store.addScoreBatch(listedKid, batch("k1", [true, true, true]), now);
  seen.privateScore = await store.addScoreBatch(privateKid, batch("k2", [true]), now);
  seen.kidTotals = await store.totalsFor(["p:nova", "p:secret", "p:nobody"]);
  seen.board = await store.leaderboard(10, "p:nova");
  seen.privateOnBoard = (await store.leaderboard(10, "p:secret")).you;
  await store.syncPlayer("p:secret", "Secret Kid", true, "🐼"); // the parent opts in
  seen.boardWithBoth = await store.leaderboard(10, "p:secret");
  await store.syncPlayer("p:nova", "Nova Renamed", false, "🚀"); // renamed and hidden
  seen.boardAfterHiding = await store.leaderboard(10, "p:nova");
  seen.limitOne = (await store.leaderboard(1)).top;

  // --- A session can hide a profile, never un-hide it (its copy of "listed" may be out of date)
  const staleCopy = session({ name: "Nova Renamed", playerKey: "p:nova", profileId: "nova", listed: true, emoji: "🚀", accountId: "acct-1" });
  await store.createSession(staleCopy);
  seen.staleSessionScore = await store.addScoreBatch(staleCopy, batch("stale", [true]), now);
  seen.boardAfterStaleSession = await store.leaderboard(10, "p:nova");

  // --- Removal is remembered: nothing puts the player back on the board
  await store.removePlayer("p:secret");
  seen.totalsAfterRemoval = await store.totalsFor(["p:secret"]);
  seen.lateWrite = await store.addScoreBatch(privateKid, batch("late", [true]), now);
  seen.boardAfterRemoval = await store.leaderboard(10, "p:secret");
  const secretAgain = session({ name: "Secret Kid", playerKey: "p:secret", profileId: "secret", listed: true, emoji: "🐼", accountId: "acct-1" });
  await store.createSession(secretAgain); // a new session for the removed profile
  await store.addScoreBatch(secretAgain, batch("again", [true]), now);
  await store.syncPlayer("p:secret", "Secret Kid", true, "🐼"); // the parent switches the leaderboard on
  seen.removedStaysOff = await store.leaderboard(10, "p:secret");
  seen.removedTotalStillCounts = await store.totalsFor(["p:secret"]);
  await store.removePlayer("ana maría"); // an operator removes a guest's row
  const back = session({ name: "Ana María", playerKey: "ana maría", listed: true });
  await store.createSession(back);
  seen.removedGuestPlaysAgain = await store.addScoreBatch(back, batch("again", [true, true]), now);
  seen.boardWithoutRemovedGuest = await store.leaderboard(10, "ana maría");

  // --- A guest who earns nothing leaves nothing behind
  const quiet = session({ name: "Quiet", playerKey: "quiet", listed: true });
  await store.createSession(quiet);
  seen.noPoints = await store.addScoreBatch(quiet, batch("q1", [false, false]), now);
  seen.quietOnBoard = (await store.leaderboard(10, "quiet")).you;

  // --- Guest nicknames belong to one browser
  seen.claims = [
    await store.claimGuestName("zoe", "browser-a", now),
    await store.claimGuestName("zoe", "browser-b", now),
    await store.claimGuestName("zoe", "browser-a", now),
    await store.claimGuestName("yan", "browser-b", now),
  ];

  // --- Ending a session
  await store.deleteSession(guest.id);
  seen.deleted = await store.getSession(guest.id, now);

  // --- Pruning: 620 guests, keep the top 550; kid profiles are never touched
  for (let i = 0; i < 620; i++) {
    const s = session({ name: `Guest ${i}`, playerKey: `guest ${i}`, listed: true });
    await store.createSession(s);
    // The first 550 get 20 points, the rest 10.
    await store.addScoreBatch(s, batch("p", i < 550 ? [true, true] : [true], 0), now);
  }
  const before = await store.leaderboard(1000);
  seen.beforePrune = { rows: before.top.length, kids: before.top.filter((e) => e.emoji).map((e) => e.name) };
  // The other guests on the board at this point ("Speedy") rank below every 20-point guest.
  seen.pruned = await store.pruneGuests(550);
  const after = await store.leaderboard(1000);
  seen.afterPrune = {
    rows: after.top.length,
    guestPoints: [...new Set(after.top.filter((e) => !e.emoji).map((e) => e.points))],
    kids: after.top.filter((e) => e.emoji).map((e) => e.name),
  };
  seen.prunedAgain = await store.pruneGuests(550);
  seen.kidTotalsAfterPrune = await store.totalsFor(["p:nova"]);
  return seen;
}

describe("the leaderboard store", () => {
  it("scores, ranks, hides, removes and prunes as the handlers expect (memory)", async () => {
    const seen = (await scenario(new MemoryStore())) as Record<string, any>;

    expect(seen.guestSession).toEqual({ id: "scenario-1", name: "Ana María", playerKey: "ana maría", expiresAt: 3_600_000, points: 0, listed: true });
    expect(seen.kidSession).toMatchObject({ profileId: "nova", accountId: "acct-1", listed: true });
    expect(seen.privateSession).toMatchObject({ listed: false });
    expect(seen.unknownSession).toBeNull();
    expect(seen.sessionAfterItsHour).toBeNull();
    expect(seen.boardBeforeAnyPoints).toEqual({ top: [], you: null });

    expect(seen.first).toEqual({ pointsEarned: 20, sessionPoints: 20, totalPoints: 20, replay: false });
    expect(seen.forgedStreak).toMatchObject({ pointsEarned: 10 }); // no bonus from the claimed 200
    expect(seen.carried).toEqual({ pointsEarned: 25, sessionPoints: 55, totalPoints: 55, replay: false });
    expect(seen.newRound).toMatchObject({ pointsEarned: 10 });
    expect(seen.replay).toEqual({ ...seen.carried, replay: true });
    expect(seen.conflict).toBe("conflict");
    expect(seen.totals).toEqual({ pointsEarned: 0, sessionPoints: 65, totalPoints: 65, replay: false });
    expect(seen.guestAfterScoring).toMatchObject({ points: 65 });

    expect(seen.burst).toMatchObject({ pointsEarned: 0 });
    expect(seen.tooFast).toBe("limited");
    expect(seen.afterWaiting).toMatchObject({ pointsEarned: 10, sessionPoints: 10 });
    expect(seen.tooFastAgain).toBe("limited");
    expect(seen.hugeBatch).toBe("limited");
    expect(seen.newSessionSameLimit).toBe("limited");
    expect(seen.newSessionAfterWaiting).toMatchObject({ pointsEarned: 0 });
    expect(seen.expired).toBe("expired");
    expect(seen.kidDevices).toEqual([...new Array(PROFILE_PACE_SCALE).fill("ok"), "limited"]);

    expect(seen.oddNames).toEqual({
      "42": { name: "42", playerKey: "42", total: 20 },
      "42.0": { name: "42.0", playerKey: "42.0", total: 10 },
      "1e3": { name: "1e3", playerKey: "1e3", total: 10 },
      "0": { name: "0", playerKey: "0", total: 10 },
      true: { name: "true", playerKey: "true", total: 10 },
      null: { name: "null", playerKey: "null", total: 10 },
      "007": { name: "007", playerKey: "007", total: 10 },
    });
    expect(seen.oddNamesOnBoard).toEqual(["007=10", "0=10", "1e3=10", "42.0=10", "42=20", "null=10", "true=10"]);
    expect(seen.oddYou).toMatchObject({ name: "42.0", points: 10 });

    expect(seen.kidScore).toEqual({ pointsEarned: 35, sessionPoints: 35, totalPoints: 35, replay: false });
    expect(seen.kidTotals).toEqual({ "p:nova": 35, "p:secret": 10, "p:nobody": 0 });
    expect(seen.board).toEqual({
      top: [
        { rank: 1, name: "Ana María", points: 65 },
        { rank: 2, name: "Nova7", points: 35, emoji: "🦊" },
        { rank: 3, name: "Speedy", points: 10 },
      ],
      you: { rank: 2, name: "Nova7", points: 35, emoji: "🦊" },
    });
    expect(seen.privateOnBoard).toBeNull();
    expect(seen.boardWithBoth.you).toEqual({ rank: 4, name: "Secret Kid", points: 10, emoji: "🐼" }); // ties rank in reverse key order, as in Redis
    expect(seen.boardAfterHiding).toMatchObject({ you: null });
    expect(JSON.stringify(seen.boardAfterHiding)).not.toContain("Nova");
    expect(seen.limitOne).toEqual([{ rank: 1, name: "Ana María", points: 65 }]);

    expect(seen.staleSessionScore).toMatchObject({ pointsEarned: 10, totalPoints: 45 });
    expect(seen.boardAfterStaleSession.you).toBeNull();
    expect(JSON.stringify(seen.boardAfterStaleSession)).not.toContain("Nova");

    expect(seen.totalsAfterRemoval).toEqual({ "p:secret": 0 });
    expect(seen.lateWrite).toMatchObject({ pointsEarned: 10 });
    expect(seen.boardAfterRemoval.you).toBeNull();
    expect(JSON.stringify(seen.boardAfterRemoval)).not.toContain("Secret Kid");
    expect(seen.removedStaysOff.you).toBeNull();
    expect(JSON.stringify(seen.removedStaysOff)).not.toContain("Secret Kid");
    expect(seen.removedTotalStillCounts).toEqual({ "p:secret": 20 }); // points still count privately
    expect(seen.removedGuestPlaysAgain).toEqual({ pointsEarned: 20, sessionPoints: 20, totalPoints: 20, replay: false });
    expect(seen.boardWithoutRemovedGuest).toEqual({ top: [{ rank: 1, name: "Speedy", points: 10 }], you: null });

    expect(seen.noPoints).toEqual({ pointsEarned: 0, sessionPoints: 0, totalPoints: 0, replay: false });
    expect(seen.quietOnBoard).toBeNull();
    expect(seen.claims).toEqual([true, false, true, true]);
    expect(seen.deleted).toBeNull();

    expect(seen.beforePrune).toEqual({ rows: 621, kids: [] }); // 620 guests + Speedy; both kids are hidden or removed by now
    expect(seen.pruned).toEqual({ removed: 71 }); // the 70 ten-point guests and Speedy
    expect(seen.afterPrune).toEqual({ rows: 550, guestPoints: [20], kids: [] });
    expect(seen.prunedAgain).toEqual({ removed: 0 });
    expect(seen.kidTotalsAfterPrune).toEqual({ "p:nova": 45 });
  });

  it.skipIf(!redisUrl)("behaves exactly the same on Redis", async () => {
    const redis = new Redis({ url: redisUrl!, token: redisToken });
    await redis.flushall();
    const onRedis = await scenario(new RedisStore(redis));
    const inMemory = await scenario(new MemoryStore());
    expect(onRedis).toEqual(inMemory);

    // What only Redis can show: keys expire on their own, and nothing unexpected is left behind.
    expect(await redis.pttl("session:scenario-2")).toBeGreaterThan(0);
    expect(await redis.pttl("guest-owner:zoe")).toBeGreaterThan(0);
    expect(await redis.sismember("leaderboard-removed", "p:secret")).toBe(1); // the removal marker
    expect(await redis.sismember("leaderboard-hidden", "p:secret")).toBe(0);
    expect(await redis.pttl("pace:speedy")).toBeGreaterThan(0); // the pace record forgets itself
    expect(await redis.hexists("player-names", "quiet")).toBe(0);
    expect(await redis.hlen("player-names")).toBe(550 + 3); // the guests kept, plus the three kid profiles written to
    await redis.flushall();
  }, 120_000);
});
