// One-off cleanup: removes leaderboard data left behind for kid profiles that
// no longer exist.
//
// Before sessions were checked against the database on every request, a
// session stayed valid for up to an hour after its profile (or the whole
// account) was deleted, and a score saved in that hour recreated the deleted
// kid's total, nickname and, possibly, public leaderboard entry. Nothing
// creates such leftovers any more; this removes the ones already there.
//
//   node scripts/cleanup-orphan-players.mjs          show what would be removed
//   node scripts/cleanup-orphan-players.mjs --yes    remove it
//
// Needs the store's credentials and the accounts database in the environment
// (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or the KV_REST_API_ pair,
// and DATABASE_URL), e.g.
//   vercel env run -e production -- node scripts/cleanup-orphan-players.mjs
//
// For every "p:<profile id>" found in leaderboard, player-names, player-totals,
// player-emojis or leaderboard-hidden with no row in kid_profiles, it does what
// RedisStore.removePlayer does (server/store.ts), so the key is also added to
// `leaderboard-removed` and can't be listed again.
//
// If *every* profile key looks deleted, DATABASE_URL most likely points at a
// different environment than Redis: the script then removes nothing unless it
// is also given --all-orphans.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { Redis } from "@upstash/redis";

const PAGE = 500;
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Every member or field name of a key, read in pages. `width` is 2 where each entry comes with a value. */
async function scanAll(scan, width) {
  const found = [];
  let cursor = "0";
  do {
    const [next, page] = await scan(cursor);
    for (let i = 0; i < page.length; i += width) found.push(String(page[i]));
    cursor = String(next);
  } while (cursor !== "0");
  return found;
}

/** The kid profile keys ("p:<id>") that have leaderboard data of any kind. */
export async function profileKeys(redis) {
  const [board, names, totals, emojis, hidden] = await Promise.all([
    scanAll((cursor) => redis.zscan("leaderboard", cursor, { count: PAGE }), 2),
    scanAll((cursor) => redis.hscan("player-names", cursor, { count: PAGE }), 2),
    scanAll((cursor) => redis.hscan("player-totals", cursor, { count: PAGE }), 2),
    scanAll((cursor) => redis.hscan("player-emojis", cursor, { count: PAGE }), 2),
    scanAll((cursor) => redis.sscan("leaderboard-hidden", cursor, { count: PAGE }), 1),
  ]);
  return [...new Set([...board, ...names, ...totals, ...emojis, ...hidden])].filter((key) => key.startsWith("p:")).sort();
}

/**
 * Finds the profile keys with no profile behind them and, with `apply`, removes
 * them. `existingProfileIds(ids)` returns which of those profile ids still exist.
 */
export async function cleanupOrphanPlayers(redis, existingProfileIds, { apply = false, allowAll = false } = {}) {
  const keys = await profileKeys(redis);
  const existing = new Set();
  for (const batch of chunks(keys.map((key) => key.slice(2)), PAGE)) {
    for (const id of await existingProfileIds(batch)) existing.add(String(id));
  }
  const orphans = keys.filter((key) => !existing.has(key.slice(2)));
  const suspicious = keys.length > 0 && orphans.length === keys.length;
  const removed = apply && orphans.length > 0 && (!suspicious || allowAll);
  if (removed) {
    for (const key of orphans) {
      // The same steps as RedisStore.removePlayer.
      await redis
        .multi()
        .sadd("leaderboard-removed", key)
        .srem("leaderboard-hidden", key)
        .zrem("leaderboard", key)
        .hdel("player-names", key)
        .hdel("player-emojis", key)
        .hdel("player-totals", key)
        .del(`guest-owner:${key}`)
        .del(`pace:${key}`)
        .exec();
    }
  }
  return { profileKeys: keys.length, orphans, suspicious, removed };
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Set DATABASE_URL (the accounts database of the same environment as Redis).");
    process.exit(2);
  }
  const sql = neon(process.env.DATABASE_URL);
  const existing = async (ids) => (await sql.query("select id from kid_profiles where id = any($1)", [ids])).map((row) => row.id);
  const result = await cleanupOrphanPlayers(new Redis({ url, token }), existing, { apply: args.includes("--yes"), allowAll: args.includes("--all-orphans") });

  console.log(`Kid profile keys with leaderboard data: ${result.profileKeys}`);
  console.log(`With no profile in the database:        ${result.orphans.length}`);
  for (const key of result.orphans) console.log(`  ${key}`);
  if (result.suspicious && !result.removed) {
    console.error("\nEvery one of them looks deleted. Check that DATABASE_URL and Redis belong to the same environment.");
    console.error("Nothing was changed. If this really is right, run again with --yes --all-orphans.");
    process.exit(1);
  }
  if (result.removed) {
    // The same shape as the server's security log: ids and counts only.
    console.log(JSON.stringify({ removed: result.orphans.length, ts: new Date().toISOString(), kind: "security", event: "admin.leaderboard.orphans_removed" }));
    console.log("Removed. These players will not be listed on the leaderboard again.");
  } else if (result.orphans.length) {
    console.log("\nNothing was changed. Run again with --yes to remove them.");
  } else {
    console.log("\nNothing to clean up.");
  }
}
