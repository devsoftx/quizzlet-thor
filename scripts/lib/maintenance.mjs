// Shared by the maintenance scripts in this folder. Every script only reports
// what it would do unless it is run with --apply.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";

/** True when the file at `metaUrl` is the script being run (not imported by a test). */
export const isMain = (metaUrl) => Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;

export function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The same Redis the app uses, from the same environment variables. */
export function redisFromEnv(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (!url || !token) fail("Redis isn't configured: set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_ pair).");
  return new Redis({ url, token });
}

export function databaseUrl(env = process.env) {
  if (!env.DATABASE_URL) fail("DATABASE_URL is not set.");
  return env.DATABASE_URL;
}

export const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** Every field name of a hash, read in pages. */
export async function hashFields(redis, key) {
  const fields = [];
  let cursor = "0";
  do {
    const [next, page] = await redis.hscan(key, cursor, { count: 500 });
    for (let i = 0; i < page.length; i += 2) fields.push(String(page[i]));
    cursor = String(next);
  } while (cursor !== "0");
  return fields;
}

/** Every member of a set, read in pages. */
export async function setMembers(redis, key) {
  const members = [];
  let cursor = "0";
  do {
    const [next, page] = await redis.sscan(key, cursor, { count: 500 });
    members.push(...page.map(String));
    cursor = String(next);
  } while (cursor !== "0");
  return members;
}

/** Every member of a sorted set with its score, read in pages. */
export async function sortedSetEntries(redis, key) {
  const entries = new Map();
  let cursor = "0";
  do {
    const [next, page] = await redis.zscan(key, cursor, { count: 500 });
    for (let i = 0; i < page.length; i += 2) entries.set(String(page[i]), Number(page[i + 1]));
    cursor = String(next);
  } while (cursor !== "0");
  return entries;
}

export const applyNote = (apply) => (apply ? "" : "\nNothing was changed. Run again with --apply to make the change.");
