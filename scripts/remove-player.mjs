// Takes one guest off the public leaderboard: removes their entry and stored
// nickname (for a name the blocklist missed, or one someone asked to remove).
//
// Usage: node scripts/remove-player.mjs "<nickname as shown on the board>" [--apply]
// With production settings: vercel env run -e production -- node scripts/remove-player.mjs "<nickname>" --apply
//
// The guest can earn their way back on by playing again under the same name;
// add the word to the blocklist in server/names.ts if it should stay off.
import { fail, isMain, redisFromEnv, applyNote } from "./lib/maintenance.mjs";

/** A guest's leaderboard key is their nickname in lowercase (see playerKeyFor in server/handlers.ts). */
export const guestKey = (nickname) => nickname.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");

/** Reports the player's entry and, with `apply`, removes it from `leaderboard` and `player-names`. */
export async function removePlayer(redis, key, { apply = false } = {}) {
  const [score, name] = await Promise.all([redis.zscore("leaderboard", key), redis.hget("player-names", key)]);
  const found = score !== null || name !== null;
  if (apply && found) await redis.multi().zrem("leaderboard", key).hdel("player-names", key).exec();
  return { key, found, points: score === null ? null : Number(score), name: name === null ? null : String(name), removed: apply && found };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [nickname] = args.filter((arg) => !arg.startsWith("--"));
  if (!nickname) fail('Usage: node scripts/remove-player.mjs "<nickname as shown on the board>" [--apply]');
  const key = guestKey(nickname);
  if (key.startsWith("p:")) {
    fail("That is a kid profile's key. A profile leaves the board when its parent switches off \"show on leaderboard\" or deletes the profile.");
  }
  const result = await removePlayer(redisFromEnv(), key, { apply });
  if (!result.found) {
    console.log(`No leaderboard entry or stored name for "${key}".`);
  } else {
    console.log(`${result.removed ? "Removed" : "Found"} "${key}": shown as "${result.name ?? key}", ${result.points ?? 0} points.${applyNote(apply)}`);
  }
}
