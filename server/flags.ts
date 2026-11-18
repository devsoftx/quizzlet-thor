// Operator switches that take effect without a deploy, read from Vercel
// Global Config (the `leaderboard` item):
//
//   { "enabled": true, "blockedNames": ["someword"] }
//
// `enabled: false` empties the public leaderboard (points are still saved).
// `blockedNames` refuses guest nicknames that contain one of the entries.
// With no Global Config connected, the leaderboard is on and nothing is blocked.

import { createClient } from "@vercel/global-config";
import { errorName, securityEvent } from "./log.js";

export interface LeaderboardFlags {
  enabled: boolean;
  blockedNames: string[];
}

export const DEFAULT_FLAGS: LeaderboardFlags = { enabled: true, blockedNames: [] };

/** Letters and digits only, lowercased: "B a.d-Word" and "badword" compare equal. */
export const foldName = (name: string) => name.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]/gu, "");

export function parseFlags(raw: unknown): LeaderboardFlags {
  const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const blocked = Array.isArray(item.blockedNames) ? item.blockedNames : [];
  return {
    enabled: item.enabled !== false,
    blockedNames: blocked.filter((n): n is string => typeof n === "string").map(foldName).filter(Boolean).slice(0, 1000),
  };
}

/** True when a guest nickname contains a blocked entry (ignoring case, spaces and punctuation). */
export function isBlockedName(name: string, flags: LeaderboardFlags): boolean {
  const folded = foldName(name);
  return flags.blockedNames.some((blocked) => folded.includes(blocked));
}

const CACHE_MS = 30_000;

/**
 * A reader for the flags, cached for 30 seconds per function instance. If the
 * config store can't be read, the last value read is kept (or the defaults).
 */
export function flagReader(env: Record<string, string | undefined> = process.env): () => Promise<LeaderboardFlags> {
  const connection = env.GLOBAL_CONFIG ?? env.EDGE_CONFIG;
  if (!connection) return async () => DEFAULT_FLAGS;
  const client = createClient(connection);
  let cached = DEFAULT_FLAGS;
  let readAt = 0;
  return async () => {
    if (readAt && Date.now() - readAt < CACHE_MS) return cached;
    try {
      cached = parseFlags(await client.get("leaderboard"));
    } catch (err) {
      securityEvent("flags.error", { errorName: errorName(err) });
    }
    readAt = Date.now();
    return cached;
  };
}

const globalState = globalThis as typeof globalThis & { __quizzletFlags?: { connection: string | undefined; read: () => Promise<LeaderboardFlags> } };

/** One reader per function instance, so its cache survives between requests. */
export function getFlags(env: Record<string, string | undefined> = process.env): () => Promise<LeaderboardFlags> {
  const connection = env.GLOBAL_CONFIG ?? env.EDGE_CONFIG;
  let reader = globalState.__quizzletFlags;
  if (!reader || reader.connection !== connection) {
    reader = globalState.__quizzletFlags = { connection, read: flagReader(env) };
  }
  return reader.read;
}
