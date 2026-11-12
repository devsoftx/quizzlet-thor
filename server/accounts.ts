import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AccountDeck,
  type AccountFile,
  type AccountSettings,
  type DeckInput,
  type DeckPatch,
  type KidProfile,
  type ProfileInput,
} from "../src/account-shared.js";

export * from "../src/account-shared.js";

/** A file record as the server sees it: with its private storage path. */
export interface StoredFile extends AccountFile {
  pathname: string;
}

export type FileInput = Omit<StoredFile, "id" | "createdAt">;

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

  /** Oldest first. `profileIds` only ever holds this account's profiles. */
  listDecks(): Promise<AccountDeck[]>;
  getDeck(id: string): Promise<AccountDeck | null>;
  createDeck(id: string, input: DeckInput): Promise<AccountDeck>;
  updateDeck(id: string, patch: DeckPatch): Promise<AccountDeck | null>;
  deleteDeck(id: string): Promise<boolean>;

  /** Oldest first. */
  listFiles(): Promise<StoredFile[]>;
  getFile(id: string): Promise<StoredFile | null>;
  createFile(id: string, input: FileInput): Promise<StoredFile>;
  /** Returns the deleted record, so its stored bytes can be removed too. */
  deleteFile(id: string): Promise<StoredFile | null>;
}

export interface AccountsDb {
  forAccount(accountId: string): AccountScope;
}

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ Memory

interface MemoryState {
  accounts: Map<string, Account>;
  /** accountId -> profiles (decks, files) */
  profiles: Map<string, Map<string, KidProfile>>;
  decks: Map<string, Map<string, AccountDeck>>;
  files: Map<string, Map<string, StoredFile>>;
}

/** Oldest first, ties by id (the Postgres version orders the same way). */
const byCreated = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export class MemoryAccounts implements AccountsDb {
  constructor(
    private state: MemoryState = { accounts: new Map(), profiles: new Map(), decks: new Map(), files: new Map() },
  ) {}

  forAccount(accountId: string): AccountScope {
    const state = this.state;
    const { accounts, profiles } = state;
    const mapFor = <T>(all: Map<string, Map<string, T>>) => {
      if (!all.has(accountId)) all.set(accountId, new Map());
      return all.get(accountId)!;
    };
    const own = () => mapFor(profiles);
    const decks = () => mapFor(state.decks);
    const files = () => mapFor(state.files);
    const copy = <T>(v: T): T => structuredClone(v);
    /** Like the database: assignments only to this account's existing profiles. */
    const ownProfileIds = (ids: string[] | null) => (ids === null ? null : [...new Set(ids)].filter((id) => own().has(id)).sort());

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
        state.decks.delete(accountId);
        state.files.delete(accountId);
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
        if (!own().delete(id)) return false;
        for (const d of decks().values()) {
          if (d.profileIds) d.profileIds = d.profileIds.filter((p) => p !== id);
        }
        return true;
      },

      async listDecks() {
        return [...decks().values()].map(copy).sort(byCreated);
      },
      async getDeck(id) {
        const d = decks().get(id);
        return d ? copy(d) : null;
      },
      async createDeck(id, input) {
        const now = nowIso();
        const d: AccountDeck = { id, ...input, profileIds: ownProfileIds(input.profileIds), createdAt: now, updatedAt: now };
        decks().set(id, d);
        return copy(d);
      },
      async updateDeck(id, patch) {
        const d = decks().get(id);
        if (!d) return null;
        if (patch.title !== undefined) d.title = patch.title;
        if (patch.enabled !== undefined) d.enabled = patch.enabled;
        if (patch.profileIds !== undefined) d.profileIds = ownProfileIds(patch.profileIds);
        d.updatedAt = nowIso();
        return copy(d);
      },
      async deleteDeck(id) {
        return decks().delete(id);
      },

      async listFiles() {
        return [...files().values()].map(copy).sort(byCreated);
      },
      async getFile(id) {
        const f = files().get(id);
        return f ? copy(f) : null;
      },
      async createFile(id, input) {
        const taken = [...state.files.values()].some((m) => [...m.values()].some((f) => f.pathname === input.pathname));
        if (taken) throw new Error("That file is already saved.");
        const f: StoredFile = { id, ...input, createdAt: nowIso() };
        files().set(id, f);
        return copy(f);
      },
      async deleteFile(id) {
        const f = files().get(id);
        if (!f) return null;
        files().delete(id);
        return copy(f);
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

const iso = (v: unknown) => new Date(String(v)).toISOString();

const toDeck = (r: Row): AccountDeck => ({
  id: String(r.id),
  title: String(r.title),
  description: r.description == null ? null : String(r.description),
  cardCount: Number(r.card_count),
  yaml: String(r.yaml),
  enabled: Boolean(r.enabled),
  profileIds: r.all_profiles ? null : ((r.profile_ids as string[] | null) ?? []).map(String).sort(),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const toFile = (r: Row): StoredFile => ({
  id: String(r.id),
  name: String(r.name),
  contentType: String(r.content_type),
  size: Number(r.size_bytes),
  pathname: String(r.pathname),
  createdAt: iso(r.created_at),
});

export class PostgresAccounts implements AccountsDb {
  constructor(private sql: NeonQueryFunction<false, false>) {}

  forAccount(accountId: string): AccountScope {
    const sql = this.sql;

    /** Decks with their assigned profile ids. */
    const selectDecks = (id: string | null) => sql`
      select d.*, array(
        select a.profile_id from deck_assignments a where a.deck_id = d.id order by a.profile_id
      ) as profile_ids
      from decks d
      where d.account_id = ${accountId} and (${id}::text is null or d.id = ${id}::text)
      order by d.created_at, d.id`;

    /**
     * Replaces a deck's assignments with `ids` (null: all kids). Only this
     * account's profiles can be inserted; the foreign keys enforce it too.
     */
    const assign = (deckId: string, ids: string[] | null) => sql`
      with gone as (
        delete from deck_assignments
        where account_id = ${accountId} and deck_id = ${deckId}
          and (${ids === null}::boolean or not (profile_id in (select jsonb_array_elements_text(${JSON.stringify(ids ?? [])}::jsonb))))
      )
      insert into deck_assignments (account_id, deck_id, profile_id)
      select ${accountId}, ${deckId}, p.id from kid_profiles p
      where not ${ids === null}::boolean and p.account_id = ${accountId}
        and p.id in (select jsonb_array_elements_text(${JSON.stringify(ids ?? [])}::jsonb))
      on conflict do nothing`;

    const getDeck = async (id: string) => {
      const rows = await selectDecks(id);
      return rows[0] ? toDeck(rows[0]) : null;
    };

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

      async listDecks() {
        return (await selectDecks(null)).map(toDeck);
      },
      getDeck,
      async createDeck(id, d) {
        await sql`
          insert into decks (id, account_id, title, description, card_count, yaml, enabled, all_profiles)
          values (${id}, ${accountId}, ${d.title}, ${d.description}, ${d.cardCount}, ${d.yaml}, ${d.enabled}, ${d.profileIds === null})`;
        if (d.profileIds !== null) await assign(id, d.profileIds);
        return (await getDeck(id))!;
      },
      async updateDeck(id, p) {
        const rows = await sql`
          update decks set
            title = coalesce(${p.title ?? null}::text, title),
            enabled = coalesce(${p.enabled ?? null}::boolean, enabled),
            all_profiles = case when ${p.profileIds !== undefined}::boolean then ${p.profileIds === null}::boolean else all_profiles end,
            updated_at = now()
          where account_id = ${accountId} and id = ${id}
          returning id`;
        if (!rows[0]) return null;
        if (p.profileIds !== undefined) await assign(id, p.profileIds);
        return getDeck(id);
      },
      async deleteDeck(id) {
        const rows = await sql`delete from decks where account_id = ${accountId} and id = ${id} returning id`;
        return rows.length > 0;
      },

      async listFiles() {
        const rows = await sql`select * from files where account_id = ${accountId} order by created_at, id`;
        return rows.map(toFile);
      },
      async getFile(id) {
        const rows = await sql`select * from files where account_id = ${accountId} and id = ${id}`;
        return rows[0] ? toFile(rows[0]) : null;
      },
      async createFile(id, f) {
        const rows = await sql`
          insert into files (id, account_id, pathname, name, content_type, size_bytes)
          values (${id}, ${accountId}, ${f.pathname}, ${f.name}, ${f.contentType}, ${f.size})
          returning *`;
        return toFile(rows[0]);
      },
      async deleteFile(id) {
        const rows = await sql`delete from files where account_id = ${accountId} and id = ${id} returning *`;
        return rows[0] ? toFile(rows[0]) : null;
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
