// The one-off cleanup of deleted profiles' leaderboard leftovers, against a
// real Redis. Like server/store.redis.test.ts it needs a disposable Redis
// behind an Upstash-compatible REST endpoint, and runs FLUSHALL on it:
//
//   QUIZZLET_DISPOSABLE_REDIS=1 QUIZZLET_TEST_REDIS_URL=http://127.0.0.1:8079 \
//   QUIZZLET_TEST_REDIS_TOKEN=local npm test -- scripts/cleanup-orphan-players.test.ts
//
// Run it on its own: the two files share that Redis and each empties it.

import { Redis } from "@upstash/redis";
import { beforeEach, describe, expect, it } from "vitest";
import { RedisStore, SESSION_TTL_SECONDS, type Session } from "../server/store.js";
import { cleanupOrphanPlayers, profileKeys } from "./cleanup-orphan-players.mjs";

const redisUrl = process.env.QUIZZLET_DISPOSABLE_REDIS === "1" ? process.env.QUIZZLET_TEST_REDIS_URL : undefined;
const redisToken = process.env.QUIZZLET_TEST_REDIS_TOKEN ?? "local";

describe.skipIf(!redisUrl)("cleanup-orphan-players.mjs (a real Redis)", () => {
  const redis = new Redis({ url: redisUrl ?? "http://unused.invalid", token: redisToken });
  const store = new RedisStore(redis);
  const now = Date.now();
  let ids = 0;

  /** A kid profile that played and earned 10 points, as the app stores it. */
  async function played(profileId: string, name: string, listed: boolean) {
    const session: Session = {
      id: `cleanup-${++ids}`,
      name,
      playerKey: `p:${profileId}`,
      profileId,
      accountId: "acct",
      listed,
      emoji: "🦊",
      expiresAt: now + SESSION_TTL_SECONDS * 1000,
      points: 0,
    };
    await store.createSession(session);
    await store.addScoreBatch(session, { id: `b-${ids}`, fingerprint: "f", answers: [true] }, now);
  }

  /** The database: only these profiles still exist. */
  const existing = (...alive: string[]) => async (asked: string[]) => asked.filter((id) => alive.includes(id));

  beforeEach(async () => {
    await redis.flushall();
  });

  it("removes what deleted profiles left behind, everywhere it is kept, and nothing else", async () => {
    await played("live", "Nova7", true);
    await played("gone", "Ghost", true);
    await played("hidden-gone", "Shy", false);
    // A guest with points, and a deleted profile that only left a name behind.
    const guest: Session = { id: "cleanup-guest", name: "Ana", playerKey: "ana", listed: true, expiresAt: now + SESSION_TTL_SECONDS * 1000, points: 0 };
    await store.createSession(guest);
    await store.addScoreBatch(guest, { id: "g", fingerprint: "f", answers: [true] }, now);
    await redis.hset("player-names", { "p:name-only": "Leftover" });
    expect(await profileKeys(redis)).toEqual(["p:gone", "p:hidden-gone", "p:live", "p:name-only"]);
    // The deleted kid is on the public board until the cleanup runs.
    expect((await store.leaderboard(10)).top.map((entry) => entry.name).sort()).toEqual(["Ana", "Ghost", "Nova7"]);

    const preview = await cleanupOrphanPlayers(redis, existing("live"));
    expect(preview).toEqual({ profileKeys: 4, orphans: ["p:gone", "p:hidden-gone", "p:name-only"], suspicious: false, removed: false });
    expect(await store.totalsFor(["p:gone"])).toEqual({ "p:gone": 10 }); // only looked

    const done = await cleanupOrphanPlayers(redis, existing("live"), { apply: true });
    expect(done).toMatchObject({ orphans: ["p:gone", "p:hidden-gone", "p:name-only"], removed: true });
    expect((await store.leaderboard(10)).top.map((entry) => entry.name).sort()).toEqual(["Ana", "Nova7"]);
    expect(await store.totalsFor(["p:live", "p:gone", "p:hidden-gone"])).toEqual({ "p:live": 10, "p:gone": 0, "p:hidden-gone": 0 });
    expect(await profileKeys(redis)).toEqual(["p:live"]);
    expect((await redis.smembers("leaderboard-removed")).map(String).sort()).toEqual(["p:gone", "p:hidden-gone", "p:name-only"]);

    // Like any removed player, they can't be listed again, even if a late save arrives.
    await played("gone", "Ghost", true);
    expect((await store.leaderboard(10)).top.map((entry) => entry.name).sort()).toEqual(["Ana", "Nova7"]);
    expect(await cleanupOrphanPlayers(redis, existing("live"), { apply: true })).toMatchObject({ removed: true });
    expect(await cleanupOrphanPlayers(redis, existing("live"), { apply: true })).toEqual({ profileKeys: 1, orphans: [], suspicious: false, removed: false });
  });

  it("won't remove every profile because the database it was pointed at is the wrong one", async () => {
    await played("live", "Nova7", true);
    await played("also-live", "Star", true);
    const emptyDatabase = existing();
    expect(await cleanupOrphanPlayers(redis, emptyDatabase, { apply: true })).toMatchObject({ profileKeys: 2, suspicious: true, removed: false });
    expect((await store.leaderboard(10)).top).toHaveLength(2);
    // Only when told that this really is right.
    expect(await cleanupOrphanPlayers(redis, emptyDatabase, { apply: true, allowAll: true })).toMatchObject({ removed: true });
    expect((await store.leaderboard(10)).top).toEqual([]);
  });

  it("reads every key when there is more than one page of them", async () => {
    const many = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`p:old-${i}`, `Kid ${i}`]));
    await redis.hset("player-names", many);
    await played("live", "Nova7", true);
    const result = await cleanupOrphanPlayers(redis, existing("live"), { apply: true });
    expect(result.orphans).toHaveLength(1200);
    expect(await profileKeys(redis)).toEqual(["p:live"]);
  });
});
