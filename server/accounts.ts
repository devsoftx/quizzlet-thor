import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AccountDeck,
  type AccountFile,
  type AccountSettings,
  type DeckInput,
  type DeckPatch,
  type KidDevice,
  type KidInvite,
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

  /** Replaces the profile's invitations with a new one (only its fingerprint is stored). */
  createInvite(profileId: string, tokenHash: string, createdAt: string, expiresAt: string): Promise<KidInvite>;
  /** Cancels the profile's invitations; false if there were none. */
  cancelInvites(profileId: string): Promise<boolean>;
  /** Invitations that are still unused and unexpired at `now`. */
  listInvites(now: string): Promise<KidInvite[]>;
  /** Oldest first. */
  listDevices(): Promise<KidDevice[]>;
  deleteDevice(id: string): Promise<boolean>;
}

/** Where a kid link points: one profile in one account. */
export interface LinkTarget {
  accountId: string;
  profileId: string;
}

export interface NewDevice {
  id: string;
  tokenHash: string;
  label: string;
}

/** Last-seen times are refreshed at most this often. */
const SEEN_EVERY_MS = 60 * 60 * 1000;

export interface AccountsDb {
  forAccount(accountId: string): AccountScope;

  // Kid devices aren't signed in as an account, so these look links up by
  // the fingerprint of their secret; everything else then goes through
  // forAccount(<the account the link belongs to>).

  /** An unused, unexpired invitation. */
  findInvite(tokenHash: string, now: string): Promise<(LinkTarget & { expiresAt: string }) | null>;
  /** Uses up an open invitation and links a device, in one step; null if it's no longer open. */
  redeemInvite(tokenHash: string, now: string, device: NewDevice): Promise<LinkTarget | null>;
  /** A linked device by its secret's fingerprint (refreshing when it was last seen). */
  findDevice(tokenHash: string, now: string): Promise<(LinkTarget & { id: string }) | null>;
  /** A kid's device unlinking itself. */
  removeDevice(tokenHash: string): Promise<boolean>;
}

const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ Memory

interface MemoryState {
  accounts: Map<string, Account>;
  /** accountId -> profiles (decks, files) */
  profiles: Map<string, Map<string, KidProfile>>;
  decks: Map<string, Map<string, AccountDeck>>;
  files: Map<string, Map<string, StoredFile>>;
  /** tokenHash -> invitation */
  invites: Map<string, LinkTarget & { createdAt: string; expiresAt: string; usedAt: string | null }>;
  /** device id -> device */
  devices: Map<string, KidDevice & LinkTarget & { tokenHash: string }>;
}

/** Oldest first, ties by id (the Postgres version orders the same way). */
const byCreated = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export class MemoryAccounts implements AccountsDb {
  constructor(
    private state: MemoryState = {
      accounts: new Map(),
      profiles: new Map(),
      decks: new Map(),
      files: new Map(),
      invites: new Map(),
      devices: new Map(),
    },
  ) {}

  /** Drops invitations and devices that match, like the database's cascades. */
  private dropLinks(match: (l: LinkTarget) => boolean) {
    for (const [hash, inv] of this.state.invites) if (match(inv)) this.state.invites.delete(hash);
    for (const [id, dev] of this.state.devices) if (match(dev)) this.state.devices.delete(id);
  }

  async findInvite(tokenHash: string, now: string) {
    const inv = this.state.invites.get(tokenHash);
    if (!inv || inv.usedAt || inv.expiresAt <= now) return null;
    return { accountId: inv.accountId, profileId: inv.profileId, expiresAt: inv.expiresAt };
  }

  async redeemInvite(tokenHash: string, now: string, device: NewDevice) {
    const open = await this.findInvite(tokenHash, now);
    if (!open) return null;
    this.state.invites.get(tokenHash)!.usedAt = now;
    const target = { accountId: open.accountId, profileId: open.profileId };
    this.state.devices.set(device.id, { ...device, ...target, createdAt: now, lastSeenAt: now });
    return target;
  }

  async findDevice(tokenHash: string, now: string) {
    const dev = [...this.state.devices.values()].find((d) => d.tokenHash === tokenHash);
    if (!dev) return null;
    if (Date.parse(now) - Date.parse(dev.lastSeenAt) >= SEEN_EVERY_MS) dev.lastSeenAt = now;
    return { id: dev.id, accountId: dev.accountId, profileId: dev.profileId };
  }

  async removeDevice(tokenHash: string) {
    const dev = [...this.state.devices.values()].find((d) => d.tokenHash === tokenHash);
    return dev ? this.state.devices.delete(dev.id) : false;
  }

  forAccount(accountId: string): AccountScope {
    const state = this.state;
    const { accounts, profiles } = state;
    const dropLinks = (match: (l: LinkTarget) => boolean) => this.dropLinks(match);
    const mine = (l: LinkTarget) => l.accountId === accountId;
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
        dropLinks(mine);
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
        dropLinks((l) => mine(l) && l.profileId === id);
        return true;
      },

      async createInvite(profileId, tokenHash, createdAt, expiresAt) {
        if (!own().has(profileId)) throw new Error("Profile not found.");
        for (const [hash, inv] of state.invites) {
          if (mine(inv) && inv.profileId === profileId) state.invites.delete(hash);
        }
        state.invites.set(tokenHash, { accountId, profileId, createdAt, expiresAt, usedAt: null });
        return { profileId, expiresAt };
      },
      async cancelInvites(profileId) {
        let any = false;
        for (const [hash, inv] of state.invites) {
          if (mine(inv) && inv.profileId === profileId) any = state.invites.delete(hash);
        }
        return any;
      },
      async listInvites(now) {
        return [...state.invites.values()]
          .filter((inv) => mine(inv) && !inv.usedAt && inv.expiresAt > now)
          .map((inv) => ({ profileId: inv.profileId, expiresAt: inv.expiresAt }))
          .sort((a, b) => a.profileId.localeCompare(b.profileId));
      },
      async listDevices() {
        return [...state.devices.values()]
          .filter(mine)
          .map(({ id, profileId, label, createdAt, lastSeenAt }) => ({ id, profileId, label, createdAt, lastSeenAt }))
          .sort(byCreated);
      },
      async deleteDevice(id) {
        const dev = state.devices.get(id);
        return dev && mine(dev) ? state.devices.delete(id) : false;
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

const toDevice = (r: Row): KidDevice => ({
  id: String(r.id),
  profileId: String(r.profile_id),
  label: String(r.label),
  createdAt: iso(r.created_at),
  lastSeenAt: iso(r.last_seen_at),
});

export class PostgresAccounts implements AccountsDb {
  constructor(private sql: NeonQueryFunction<false, false>) {}

  async findInvite(tokenHash: string, now: string) {
    const rows = await this.sql`
      select account_id, profile_id, expires_at from kid_invites
      where token_hash = ${tokenHash} and used_at is null and expires_at > ${now}::timestamptz`;
    const r = rows[0];
    return r ? { accountId: String(r.account_id), profileId: String(r.profile_id), expiresAt: iso(r.expires_at) } : null;
  }

  async redeemInvite(tokenHash: string, now: string, device: NewDevice) {
    // One statement: the invitation is used up only if the device is linked.
    const rows = await this.sql`
      with used as (
        update kid_invites set used_at = ${now}::timestamptz
        where token_hash = ${tokenHash} and used_at is null and expires_at > ${now}::timestamptz
        returning account_id, profile_id
      )
      insert into kid_devices (id, token_hash, account_id, profile_id, label, created_at, last_seen_at)
      select ${device.id}, ${device.tokenHash}, account_id, profile_id, ${device.label}, ${now}::timestamptz, ${now}::timestamptz
      from used
      returning account_id, profile_id`;
    const r = rows[0];
    return r ? { accountId: String(r.account_id), profileId: String(r.profile_id) } : null;
  }

  async findDevice(tokenHash: string, now: string) {
    const rows = await this.sql`
      select id, account_id, profile_id, last_seen_at from kid_devices where token_hash = ${tokenHash}`;
    const r = rows[0];
    if (!r) return null;
    if (Date.parse(now) - Date.parse(iso(r.last_seen_at)) >= SEEN_EVERY_MS) {
      await this.sql`update kid_devices set last_seen_at = ${now}::timestamptz where id = ${String(r.id)}`;
    }
    return { id: String(r.id), accountId: String(r.account_id), profileId: String(r.profile_id) };
  }

  async removeDevice(tokenHash: string) {
    const rows = await this.sql`delete from kid_devices where token_hash = ${tokenHash} returning id`;
    return rows.length > 0;
  }

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

      async createInvite(profileId, tokenHash, createdAt, expiresAt) {
        // The foreign key refuses a profile from another account.
        await sql`
          with gone as (delete from kid_invites where account_id = ${accountId} and profile_id = ${profileId})
          insert into kid_invites (token_hash, account_id, profile_id, created_at, expires_at)
          values (${tokenHash}, ${accountId}, ${profileId}, ${createdAt}::timestamptz, ${expiresAt}::timestamptz)`;
        return { profileId, expiresAt };
      },
      async cancelInvites(profileId) {
        const rows = await sql`
          delete from kid_invites where account_id = ${accountId} and profile_id = ${profileId} returning token_hash`;
        return rows.length > 0;
      },
      async listInvites(now) {
        const rows = await sql`
          select profile_id, expires_at from kid_invites
          where account_id = ${accountId} and used_at is null and expires_at > ${now}::timestamptz
          order by profile_id`;
        return rows.map((r) => ({ profileId: String(r.profile_id), expiresAt: iso(r.expires_at) }));
      },
      async listDevices() {
        const rows = await sql`select * from kid_devices where account_id = ${accountId} order by created_at, id`;
        return rows.map(toDevice);
      },
      async deleteDevice(id) {
        const rows = await sql`delete from kid_devices where account_id = ${accountId} and id = ${id} returning id`;
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
