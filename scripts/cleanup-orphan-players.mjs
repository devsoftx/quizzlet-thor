// One-off cleanup (remediation R-05): removes leaderboard data left behind for
// kid profiles that no longer exist. A session used to stay valid after its
// profile was deleted, and a score saved then recreated the player's entries.
//
// For every "p:<profile id>" in leaderboard, player-names, player-totals and
// leaderboard-hidden with no kid_profiles row, removes it from all four.
//
// Usage: vercel env run -e production -- node scripts/cleanup-orphan-players.mjs [--apply]
import { neon } from "@neondatabase/serverless";
import { applyNote, chunks, databaseUrl, fail, hashFields, isMain, redisFromEnv, setMembers, sortedSetEntries } from "./lib/maintenance.mjs";

/**
 * `existingProfileIds(ids)` returns which of those profile ids still exist.
 * Returns what was found; with `apply`, the orphans are removed.
 */
export async function cleanupOrphanPlayers(redis, existingProfileIds, { apply = false, allowAll = false } = {}) {
  const [board, names, totals, hidden] = await Promise.all([
    sortedSetEntries(redis, "leaderboard"),
    hashFields(redis, "player-names"),
    hashFields(redis, "player-totals"),
    setMembers(redis, "leaderboard-hidden"),
  ]);
  const keys = [...new Set([...board.keys(), ...names, ...totals, ...hidden])].filter((key) => key.startsWith("p:")).sort();

  const existing = new Set();
  for (const batch of chunks(keys.map((key) => key.slice(2)), 500)) {
    for (const id of await existingProfileIds(batch)) existing.add(id);
  }
  const orphans = keys.filter((key) => !existing.has(key.slice(2)));

  // Every profile looking deleted is far more likely the wrong database than the truth.
  const suspicious = keys.length > 0 && orphans.length === keys.length;
  const removed = apply && orphans.length > 0 && (!suspicious || allowAll);
  if (removed) {
    for (const batch of chunks(orphans, 100)) {
      await redis.multi().zrem("leaderboard", ...batch).hdel("player-names", ...batch).hdel("player-totals", ...batch).srem("leaderboard-hidden", ...batch).exec();
    }
  }
  return { profileKeys: keys.length, orphans, suspicious, removed };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const sql = neon(databaseUrl());
  const existing = async (ids) => (await sql.query("select id from kid_profiles where id = any($1)", [ids])).map((row) => String(row.id));
  const result = await cleanupOrphanPlayers(redisFromEnv(), existing, { apply, allowAll: args.includes("--all-orphans") });

  console.log(`${result.profileKeys} kid profile key(s) in the leaderboard data; ${result.orphans.length} with no profile in the database.`);
  for (const key of result.orphans) console.log(`  ${key}`);
  if (result.suspicious && !result.removed) {
    fail("Every one of them looks deleted. Check DATABASE_URL points at the same environment as Redis; if this really is right, add --all-orphans.");
  }
  console.log(result.removed ? "Removed." : result.orphans.length ? applyNote(apply).trim() : "Nothing to clean up.");
}
