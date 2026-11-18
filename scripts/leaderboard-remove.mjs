// Operator tool: take one player off the public leaderboard (a bad nickname,
// a forged score). There is deliberately no web route for this.
//
//   node scripts/leaderboard-remove.mjs "<nickname>"          show what would be removed
//   node scripts/leaderboard-remove.mjs "<nickname>" --yes    remove it
//   node scripts/leaderboard-remove.mjs p:<profileId> --yes   a kid profile's entry and total
//
// Needs the store's credentials in the environment (UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL and KV_REST_API_TOKEN), e.g.
//   vercel env run -e production -- node scripts/leaderboard-remove.mjs "<nickname>"
//
// It does what RedisStore.removePlayer does (server/store.ts): the entry, the
// name and the total go, and the key is added to `leaderboard-removed`. A
// removed player is never listed again: not when the nickname is used again,
// not when a kid profile starts a new session, not when its parent switches
// the leaderboard on. To undo that: SREM leaderboard-removed "<player key>".
// To refuse a guest nickname outright, add it to `blockedNames` in Global
// Config as well (see docs/security/runbook.md).
import { Redis } from "@upstash/redis";

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const given = args.find((a) => !a.startsWith("--"));
if (!given) {
  console.error('Usage: node scripts/leaderboard-remove.mjs "<nickname or p:profileId>" [--yes]');
  process.exit(2);
}
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).");
  process.exit(2);
}

// A guest's key is the lowercased nickname (as in server/handlers.ts); a kid profile's is "p:<id>".
const isProfile = given.startsWith("p:");
const playerKey = isProfile ? given : given.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");
const redis = new Redis({ url, token });

const [points, name, total, removed] = await Promise.all([
  redis.zscore("leaderboard", playerKey),
  redis.hget("player-names", playerKey),
  redis.hget("player-totals", playerKey),
  redis.sismember("leaderboard-removed", playerKey),
]);
console.log(`Player key:       ${playerKey}`);
console.log(`Shown as:         ${name === null ? "(no name stored)" : String(name)}`);
console.log(`On the board:     ${points === null ? "no" : `yes, ${points} points`}`);
if (isProfile) console.log(`Private total:    ${total === null ? "none" : `${total} points`}`);
console.log(`Removed before:   ${removed ? "yes" : "no"}`);

if (points === null && name === null && total === null) {
  console.log("\nNothing is stored for this player. Check the spelling; guests are stored by their nickname in lowercase.");
  if (!confirmed) process.exit(1);
}
if (!confirmed) {
  console.log("\nNothing was changed. Run again with --yes to remove this player.");
  process.exit(0);
}

await redis
  .multi()
  .sadd("leaderboard-removed", playerKey)
  .srem("leaderboard-hidden", playerKey)
  .zrem("leaderboard", playerKey)
  .hdel("player-names", playerKey)
  .hdel("player-emojis", playerKey)
  .hdel("player-totals", playerKey)
  .del(`guest-owner:${playerKey}`)
  .del(`pace:${playerKey}`)
  .exec();

// The same shape as the server's security log; a guest's key is their nickname, so it isn't written here.
console.log(
  JSON.stringify({
    playerKind: isProfile ? "profile" : "guest",
    profileId: isProfile ? playerKey.slice(2) : null,
    removedPoints: points === null ? 0 : Number(points),
    ts: new Date().toISOString(),
    kind: "security",
    event: "admin.leaderboard.remove",
  }),
);
console.log("Removed. This player will not be listed on the leaderboard again.");
