import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AccountSettings,
  type KidProfile,
  type ProfileInput,
} from "../src/account-shared.js";

export * from "../src/account-shared.js";

// ------------------------------------------------------------------- Types

/** A parent or teacher, keyed by their Clerk user id. */
export interface Account {
  id: string;
  displayName: string;
  plan: "free" | "pro";
  settings: AccountSettings;
  createdAt: string;
}

/** Everything one account may touch. Built per request from the verified user id. */
export interface AccountScope {
  get(): Promise<Account | null>;
  ensure(defaults: { displayName: string }): Promise<Account>;
  update(patch: { displayName?: string; settings?: AccountSettings }): Promise<Account | null>;
  /** Deletes the account and everything it owns; returns the deleted profile ids. */
  remove(): Promise<string[]>;
  listProfiles(): Promise<KidProfile[]>;
  getProfile(id: string): Promise<KidProfile | null>;
  createProfile(id: string, input: ProfileInput): Promise<KidProfile>;
  updateProfile(id: string, patch: Partial<ProfileInput>): Promise<KidProfile | null>;
  deleteProfile(id: string): Promise<boolean>;
}

export interface AccountsDb {
  forAccount(accountId: string): AccountScope;
}

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ Memory

interface MemoryState {
  accounts: Map<string, Account>;
  /** accountId -> profiles */
  profiles: Map<string, Map<string, KidProfile>>;
}

export class MemoryAccounts implements AccountsDb {
  constructor(private state: MemoryState = { accounts: new Map(), profiles: new Map() }) {}

  forAccount(accountId: string): AccountScope {
    const { accounts, profiles } = this.state;
    const own = () => {
      if (!profiles.has(accountId)) profiles.set(accountId, new Map());
      return profiles.get(accountId)!;
    };
    const copy = <T>(v: T): T => structuredClone(v);

    return {
      async get() {
        const a = accounts.get(accountId);
        return a ? copy(a) : null;
      },
      async ensure({ displayName }) {
        if (!accounts.has(accountId)) {
          accounts.set(accountId, {
            id: accountId,
            displayName,
            plan: "free",
            settings: { ...DEFAULT_SETTINGS },
            createdAt: nowIso(),
          });
        }
        return copy(accounts.get(accountId)!);
      },
      async update(patch) {
        const a = accounts.get(accountId);
        if (!a) return null;
        if (patch.displayName !== undefined) a.displayName = patch.displayName;
        if (patch.settings) a.settings = { ...patch.settings };
        return copy(a);
      },
      async remove() {
        const ids = [...own().keys()];
        accounts.delete(accountId);
        profiles.delete(accountId);
        return ids;
      },
      async listProfiles() {
        return [...own().values()].map(copy).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      async getProfile(id) {
        const p = own().get(id);
        return p ? copy(p) : null;
      },
      async createProfile(id, input) {
        const p: KidProfile = { id, ...input, createdAt: nowIso() };
        own().set(id, p);
        return copy(p);
      },
      async updateProfile(id, patch) {
        const p = own().get(id);
        if (!p) return null;
        Object.assign(p, patch);
        return copy(p);
      },
      async deleteProfile(id) {
        return own().delete(id);
      },
    };
  }
}

// ---------------------------------------------------------------- Postgres
// Every statement filters by account_id = the verified user id.

type Row = Record<string, unknown>;

const toAccount = (r: Row): Account => ({
  id: String(r.id),
  displayName: String(r.display_name),
  plan: r.plan === "pro" ? "pro" : "free",
  settings: normalizeSettings(r.settings),
  createdAt: new Date(String(r.created_at)).toISOString(),
});

const toProfile = (r: Row): KidProfile => ({
  id: String(r.id),
  nickname: String(r.nickname),
  gradeBand: (r.grade_band as KidProfile["gradeBand"]) ?? null,
  color: String(r.color),
  emoji: String(r.emoji),
  showOnLeaderboard: Boolean(r.show_on_leaderboard),
  createdAt: new Date(String(r.created_at)).toISOString(),
});

export class PostgresAccounts implements AccountsDb {
  constructor(private sql: NeonQueryFunction<false, false>) {}

  forAccount(accountId: string): AccountScope {
    const sql = this.sql;
    return {
      async get() {
        const rows = await sql`select * from accounts where id = ${accountId}`;
        return rows[0] ? toAccount(rows[0]) : null;
      },
      async ensure({ displayName }) {
        const rows = await sql`
          insert into accounts (id, display_name, settings)
          values (${accountId}, ${displayName}, ${JSON.stringify(DEFAULT_SETTINGS)}::jsonb)
          on conflict (id) do update set id = excluded.id
          returning *`;
        return toAccount(rows[0]);
      },
      async update(patch) {
        const rows = await sql`
          update accounts set
            display_name = coalesce(${patch.displayName ?? null}::text, display_name),
            settings = coalesce(${patch.settings ? JSON.stringify(patch.settings) : null}::jsonb, settings),
            updated_at = now()
          where id = ${accountId}
          returning *`;
        return rows[0] ? toAccount(rows[0]) : null;
      },
      async remove() {
        const rows = await sql`select id from kid_profiles where account_id = ${accountId}`;
        await sql`delete from accounts where id = ${accountId}`; // profiles cascade
        return rows.map((r) => String(r.id));
      },
      async listProfiles() {
        const rows = await sql`select * from kid_profiles where account_id = ${accountId} order by created_at`;
        return rows.map(toProfile);
      },
      async getProfile(id) {
        const rows = await sql`select * from kid_profiles where account_id = ${accountId} and id = ${id}`;
        return rows[0] ? toProfile(rows[0]) : null;
      },
      async createProfile(id, p) {
        const rows = await sql`
          insert into kid_profiles (id, account_id, nickname, grade_band, color, emoji, show_on_leaderboard)
          values (${id}, ${accountId}, ${p.nickname}, ${p.gradeBand}, ${p.color}, ${p.emoji}, ${p.showOnLeaderboard})
          returning *`;
        return toProfile(rows[0]);
      },
      async updateProfile(id, p) {
        const rows = await sql`
          update kid_profiles set
            nickname = coalesce(${p.nickname ?? null}::text, nickname),
            grade_band = case when ${"gradeBand" in p}::boolean then ${p.gradeBand ?? null}::text else grade_band end,
            color = coalesce(${p.color ?? null}::text, color),
            emoji = coalesce(${p.emoji ?? null}::text, emoji),
            show_on_leaderboard = coalesce(${p.showOnLeaderboard ?? null}::boolean, show_on_leaderboard),
            updated_at = now()
          where account_id = ${accountId} and id = ${id}
          returning *`;
        return rows[0] ? toProfile(rows[0]) : null;
      },
      async deleteProfile(id) {
        const rows = await sql`delete from kid_profiles where account_id = ${accountId} and id = ${id} returning id`;
        return rows.length > 0;
      },
    };
  }
}

// ----------------------------------------------------------------- Factory

const globalState = globalThis as typeof globalThis & { __quizzletMemoryAccounts?: MemoryAccounts };

/** Postgres when DATABASE_URL is set; memory locally; null on Vercel without a database. */
export function getAccountsDb(env: Record<string, string | undefined> = process.env): AccountsDb | null {
  if (env.DATABASE_URL) return new PostgresAccounts(neon(env.DATABASE_URL));
  if (env.VERCEL) return null;
  return (globalState.__quizzletMemoryAccounts ??= new MemoryAccounts());
}
