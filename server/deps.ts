import { getAccountsDb, type AccountsDb } from "./accounts.js";
import { getAuthenticator, type Authenticator } from "./auth.js";
import { getFileStore, type FileStore } from "./files.js";
import { getFlags, type LeaderboardFlags } from "./flags.js";
import { getStore, type Store } from "./store.js";

/** Everything a handler needs from the outside world; tests pass their own. */
export interface Deps {
  store: Store | null;
  now: () => number;
  newId: () => string;
  /** Sign-in check; null when accounts aren't set up. */
  auth?: Authenticator | null;
  /** Accounts and kid profiles; null when there's no database. */
  accounts?: AccountsDb | null;
  /** Private file storage; null when no Blob store is connected. */
  files?: FileStore | null;
  /** Operator switches (leaderboard on/off, blocked nicknames); the defaults when absent. */
  flags?: () => Promise<LeaderboardFlags>;
  /** What the scheduled cleanup must present (CRON_SECRET); without it the cleanup refuses to run. */
  cronSecret?: string | null;
}

export function defaultDeps(): Deps {
  return {
    store: getStore(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    auth: getAuthenticator(),
    accounts: getAccountsDb(),
    files: getFileStore(),
    flags: getFlags(),
    cronSecret: process.env.CRON_SECRET || null,
  };
}
