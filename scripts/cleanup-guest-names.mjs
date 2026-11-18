// One-off cleanup (remediation R-03): removes guest nicknames that were stored
// for sessions that never earned a point. Starting a guest session used to add
// a permanent player-names entry; names are now stored when points are first earned.
//
// Removes every player-names entry without the "p:" prefix that has no
// leaderboard score above zero, and guests' zero-point leaderboard members.
//
// Usage: vercel env run -e production -- node scripts/cleanup-guest-names.mjs [--apply]
import { applyNote, chunks, hashFields, isMain, redisFromEnv, sortedSetEntries } from "./lib/maintenance.mjs";

export async function cleanupGuestNames(redis, { apply = false } = {}) {
  const [names, board] = await Promise.all([hashFields(redis, "player-names"), sortedSetEntries(redis, "leaderboard")]);
  const isGuest = (key) => !key.startsWith("p:");
  const hasPoints = (key) => (board.get(key) ?? 0) > 0;
  const unusedNames = names.filter((key) => isGuest(key) && !hasPoints(key)).sort();
  const emptyEntries = [...board.keys()].filter((key) => isGuest(key) && !hasPoints(key)).sort();

  if (apply) {
    for (const batch of chunks(unusedNames, 100)) await redis.hdel("player-names", ...batch);
    for (const batch of chunks(emptyEntries, 100)) await redis.zrem("leaderboard", ...batch);
  }
  return { names: names.length, unusedNames, emptyEntries, removed: apply && unusedNames.length + emptyEntries.length > 0 };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  const result = await cleanupGuestNames(redisFromEnv(), { apply });
  console.log(`${result.names} stored name(s); ${result.unusedNames.length} guest name(s) with no points, ${result.emptyEntries.length} empty leaderboard entr${result.emptyEntries.length === 1 ? "y" : "ies"}.`);
  for (const key of result.unusedNames.slice(0, 50)) console.log(`  ${key}`);
  if (result.unusedNames.length > 50) console.log(`  … and ${result.unusedNames.length - 50} more`);
  console.log(result.removed ? "Removed." : result.unusedNames.length + result.emptyEntries.length ? applyNote(apply).trim() : "Nothing to clean up.");
}
