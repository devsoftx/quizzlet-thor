// The maintenance scripts, run against a real Redis (and an in-process
// Postgres where they read the accounts database). Like server/store.test.ts,
// the Redis parts need `redis-server` on the PATH or QUIZZLET_TEST_REDIS, and
// are skipped without one.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedisStore, type Session } from "../server/store.js";
import { redisAvailable, startTestRedis, type TestRedis } from "../server/test-support/redis.js";
import { cleanupGuestNames } from "./cleanup-guest-names.mjs";
import { cleanupOrphanBlobs } from "./cleanup-orphan-blobs.mjs";
import { cleanupOrphanPlayers } from "./cleanup-orphan-players.mjs";
import { guestKey, removePlayer } from "./remove-player.mjs";

const run = promisify(execFile);
const T0 = Date.UTC(2026, 10, 18, 12);
const HOUR = 60 * 60 * 1000;

let sessions = 0;
function guest(name: string): Session {
  return { id: `s-${++sessions}`, name, playerKey: name.toLowerCase(), expiresAt: T0 + HOUR, points: 0, listed: true };
}
function kid(id: string, name: string, listed = true): Session {
  return { id: `s-${++sessions}`, name, playerKey: `p:${id}`, profileId: id, accountId: "acct", expiresAt: T0 + HOUR, points: 0, listed };
}

let batches = 0;
async function play(store: RedisStore, session: Session, answers: boolean[]) {
  await store.createSession(session);
  return store.addScoreBatch(session, { id: `b-${++batches}`, fingerprint: "f", answers }, T0);
}

describe.skipIf(!redisAvailable)("maintenance scripts (a real Redis)", () => {
  let server: TestRedis;
  let store: RedisStore;
  let pg: PGlite;

  beforeAll(async () => {
    server = await startTestRedis();
    store = new RedisStore(server.redis);
    pg = new PGlite();
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(readFileSync(new URL(file, dir), "utf8"));
    }
    await pg.exec(`
      insert into accounts (id, display_name) values ('acct', 'Ana');
      insert into kid_profiles (id, account_id, nickname, color, emoji) values ('live', 'acct', 'Nova7', '#4255ff', '🦊');`);
  });
  afterAll(async () => {
    await server?.stop();
    await pg?.close();
  });
  beforeEach(async () => {
    await server.flush();
  });

  /** Which of these profile ids still have a row, as the script asks the database. */
  const existingProfiles = async (ids: string[]) =>
    (await pg.query<{ id: string }>("select id from kid_profiles where id = any($1)", [ids])).rows.map((row) => row.id);

  const names = async () => Object.keys((await server.redis.hgetall("player-names")) ?? {}).sort();
  const boardKeys = async () => (await server.redis.zrange<string[]>("leaderboard", 0, -1)).map(String).sort();

  describe("remove-player.mjs", () => {
    /** Runs the script itself, as from a terminal, against the test Redis. */
    const cli = (...args: string[]) =>
      run(process.execPath, ["scripts/remove-player.mjs", ...args], {
        env: { PATH: process.env.PATH, ...server.env },
      }).then(
        (out) => ({ code: 0, text: out.stdout + out.stderr }),
        (err: { code: number; stdout: string; stderr: string }) => ({ code: err.code, text: err.stdout + err.stderr }),
      );

    it("clears a guest's entry, and it isn't back on the next leaderboard read", async () => {
      await play(store, guest("Bad Name"), [true, true]);
      await play(store, guest("Ana"), [true]);
      expect((await store.leaderboard(10)).top.map((e) => e.name)).toEqual(["Bad Name", "Ana"]);

      // Without --apply it only reports.
      const preview = await cli("Bad  Name");
      expect(preview).toEqual({ code: 0, text: expect.stringContaining('Found "bad name": shown as "Bad Name", 20 points.') });
      expect(preview.text).toContain("Nothing was changed.");
      expect((await store.leaderboard(10)).top).toHaveLength(2);

      const removed = await cli("Bad Name", "--apply");
      expect(removed).toEqual({ code: 0, text: expect.stringContaining('Removed "bad name"') });
      const board = await store.leaderboard(10, "bad name");
      expect(board).toEqual({ top: [{ rank: 1, name: "Ana", points: 10 }], you: null });
      expect(await store.leaderboard(10, "bad name")).toEqual(board); // and it stays gone
      expect(await names()).toEqual(["ana"]);
      expect(await boardKeys()).toEqual(["ana"]);

      expect((await cli("Bad Name", "--apply")).text).toContain('No leaderboard entry or stored name for "bad name".');
    });

    it("leaves kid profiles to their parents, and says what it needs", async () => {
      await play(store, kid("live", "Nova7"), [true]);
      const profile = await cli("p:live", "--apply");
      expect(profile.code).toBe(1);
      expect(profile.text).toContain("That is a kid profile's key.");
      expect(await boardKeys()).toEqual(["p:live"]);

      expect((await cli()).text).toContain("Usage: node scripts/remove-player.mjs");
      const noRedis = await run(process.execPath, ["scripts/remove-player.mjs", "Ana"], { env: { PATH: process.env.PATH } }).catch((err) => err);
      expect(noRedis.code).toBe(1);
      expect(noRedis.stderr).toContain("Redis isn't configured");
    });

    it("finds the entry by the nickname as shown, whatever its case or spacing", async () => {
      expect(guestKey("  Ana   MARÍA ")).toBe("ana maría");
      await play(store, guest("Ana María"), [true]);
      expect(await removePlayer(server.redis, guestKey("ANA  maría"))).toEqual({ key: "ana maría", found: true, points: 10, name: "Ana María", removed: false });
      expect(await removePlayer(server.redis, guestKey("ANA  maría"), { apply: true })).toMatchObject({ found: true, removed: true });
      expect(await removePlayer(server.redis, "ana maría", { apply: true })).toEqual({ key: "ana maría", found: false, points: null, name: null, removed: false });
    });
  });

  describe("cleanup-orphan-players.mjs", () => {
    it("removes what deleted profiles left behind, from all four places, and nothing else", async () => {
      await play(store, kid("live", "Nova7"), [true]);
      await play(store, kid("gone", "Ghost"), [true, true]);
      await play(store, kid("hidden-gone", "Shy", false), [true]);
      await play(store, guest("Ana"), [true]);
      // A deleted profile that only left a name behind.
      await server.redis.hset("player-names", { "p:name-only": "Leftover" });

      const preview = await cleanupOrphanPlayers(server.redis, existingProfiles);
      expect(preview).toEqual({ profileKeys: 4, orphans: ["p:gone", "p:hidden-gone", "p:name-only"], suspicious: false, removed: false });
      expect(await store.totalsFor(["p:gone"])).toEqual({ "p:gone": 20 });

      const done = await cleanupOrphanPlayers(server.redis, existingProfiles, { apply: true });
      expect(done).toMatchObject({ orphans: ["p:gone", "p:hidden-gone", "p:name-only"], removed: true });
      expect(await names()).toEqual(["ana", "p:live"]);
      expect(await boardKeys()).toEqual(["ana", "p:live"]);
      expect(await store.totalsFor(["p:live", "p:gone", "p:hidden-gone"])).toEqual({ "p:live": 10, "p:gone": 0, "p:hidden-gone": 0 });
      expect(await server.redis.smembers("leaderboard-hidden")).toEqual([]);
      expect((await store.leaderboard(10)).top.map((e) => e.name).sort()).toEqual(["Ana", "Nova7"]);

      expect(await cleanupOrphanPlayers(server.redis, existingProfiles, { apply: true })).toEqual({ profileKeys: 1, orphans: [], suspicious: false, removed: false });
    });

    it("won't wipe every profile because the database it was pointed at is the wrong one", async () => {
      await play(store, kid("live", "Nova7"), [true]);
      await play(store, kid("also-live", "Star"), [true]);
      const emptyDatabase = async () => [];
      const refused = await cleanupOrphanPlayers(server.redis, emptyDatabase, { apply: true });
      expect(refused).toMatchObject({ profileKeys: 2, suspicious: true, removed: false });
      expect(await boardKeys()).toEqual(["p:also-live", "p:live"]);
      // Only when told that this really is right.
      expect(await cleanupOrphanPlayers(server.redis, emptyDatabase, { apply: true, allowAll: true })).toMatchObject({ removed: true });
      expect(await boardKeys()).toEqual([]);
    });
  });

  describe("cleanup-guest-names.mjs", () => {
    it("removes the names of guests who never scored, and keeps everyone on the board", async () => {
      await play(store, guest("Ana"), [true]);
      await play(store, kid("live", "Nova7", false), [true]); // a private profile: a name and no board entry
      // What the previous version left: a name for every session started, and 0-point board members.
      await server.redis.hset("player-names", { ghost: "Ghost", "never played": "Never Played", zero: "Zero" });
      await server.redis.zadd("leaderboard", { score: 0, member: "zero" }, { score: 0, member: "nameless" });

      const preview = await cleanupGuestNames(server.redis);
      expect(preview).toEqual({ names: 5, unusedNames: ["ghost", "never played", "zero"], emptyEntries: ["nameless", "zero"], removed: false });
      expect(await names()).toHaveLength(5);

      expect(await cleanupGuestNames(server.redis, { apply: true })).toMatchObject({ removed: true });
      expect(await names()).toEqual(["ana", "p:live"]);
      expect(await boardKeys()).toEqual(["ana"]);
      expect((await store.leaderboard(10)).top).toEqual([{ rank: 1, name: "Ana", points: 10 }]);
      expect(await cleanupGuestNames(server.redis, { apply: true })).toEqual({ names: 2, unusedNames: [], emptyEntries: [], removed: false });
    });

    it("reads every name when there are more than one page of them", async () => {
      const many = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`guest ${i}`, `Guest ${i}`]));
      await server.redis.hset("player-names", many);
      await play(store, guest("Ana"), [true]);
      const result = await cleanupGuestNames(server.redis, { apply: true });
      expect(result.unusedNames).toHaveLength(1500);
      expect(await names()).toEqual(["ana"]);
    });
  });
});

describe("cleanup-orphan-blobs.mjs", () => {
  const NOW = Date.UTC(2026, 10, 18, 12);
  const old = new Date(NOW - 3 * HOUR).toISOString();
  const recent = new Date(NOW - 10 * 60 * 1000).toISOString();

  /** Storage as two pages of a listing, a set of recorded paths, and a record of what was deleted. */
  function storage(blobs: Array<{ pathname: string; size: number; uploadedAt: string }>, recorded: string[]) {
    const deleted: string[] = [];
    return {
      deleted,
      deps: {
        listPage: async (cursor?: string) => {
          const half = Math.ceil(blobs.length / 2);
          return cursor ? { blobs: blobs.slice(half) } : { blobs: blobs.slice(0, half), cursor: blobs.length > half ? "next" : undefined };
        },
        knownPaths: async (paths: string[]) => paths.filter((path) => recorded.includes(path)),
        remove: async (paths: string[]) => void deleted.push(...paths),
      },
    };
  }

  const blobs = [
    { pathname: "users/a/uploads/1/saved.pdf", size: 100, uploadedAt: old },
    { pathname: "users/a/uploads/2/never-confirmed.pdf", size: 5000, uploadedAt: old },
    { pathname: "users/a/uploads/3/in-progress.pdf", size: 70, uploadedAt: recent },
    { pathname: "users/b/uploads/4/abandoned.png", size: 3000, uploadedAt: old },
    { pathname: "users/b/uploads/5/just-arrived.png", size: 40, uploadedAt: recent },
  ];
  // Saved files and uploads still in progress both have a record.
  const recorded = ["users/a/uploads/1/saved.pdf", "users/a/uploads/3/in-progress.pdf"];

  it("deletes stored files with no record, except ones that only just arrived", async () => {
    const preview = storage(blobs, recorded);
    const found = await cleanupOrphanBlobs(preview.deps, { now: NOW });
    expect(found).toEqual({
      blobs: 5,
      orphans: [
        { pathname: "users/a/uploads/2/never-confirmed.pdf", size: 5000 },
        { pathname: "users/b/uploads/4/abandoned.png", size: 3000 },
      ],
      bytes: 8000,
      suspicious: false,
      removed: false,
    });
    expect(preview.deleted).toEqual([]);

    const real = storage(blobs, recorded);
    expect(await cleanupOrphanBlobs(real.deps, { now: NOW, apply: true })).toMatchObject({ removed: true });
    expect(real.deleted).toEqual(["users/a/uploads/2/never-confirmed.pdf", "users/b/uploads/4/abandoned.png"]);
  });

  it("won't delete everything because the database it was pointed at is the wrong one", async () => {
    const settled = blobs.map((blob) => ({ ...blob, uploadedAt: old }));
    const wrongDatabase = storage(settled, []);
    expect(await cleanupOrphanBlobs(wrongDatabase.deps, { now: NOW, apply: true })).toMatchObject({ blobs: 5, suspicious: true, removed: false });
    expect(wrongDatabase.deleted).toEqual([]);
    expect(await cleanupOrphanBlobs(wrongDatabase.deps, { now: NOW, apply: true, allowAll: true })).toMatchObject({ removed: true });
    expect(wrongDatabase.deleted).toHaveLength(5);

    const empty = storage([], []);
    expect(await cleanupOrphanBlobs(empty.deps, { now: NOW, apply: true })).toEqual({ blobs: 0, orphans: [], bytes: 0, suspicious: false, removed: false });
  });
});
