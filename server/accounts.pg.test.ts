// Runs the real migration and the Postgres account code against PGlite (an
// in-process Postgres), checking it behaves exactly like the memory version.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pgDriver from "pg";
import { MAX_DECKS, MAX_FILES, MAX_PROFILES, MAX_TOTAL_FILE_BYTES, MemoryAccounts, PostgresAccounts, type AccountsDb } from "./accounts.js";
import { sqlForPglite, sqlForPool } from "./test-support/sql.js";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(new URL(file, dir), "utf8"));
  }
});

const sqlFor = sqlForPglite;

/** The same scenario against any implementation; returns everything observed. */
async function scenario(db: AccountsDb, prefix: string) {
  const a = db.forAccount(`${prefix}-a`);
  const b = db.forAccount(`${prefix}-b`);
  const seen: Record<string, unknown> = {};
  const strip = <T extends { createdAt?: string; updatedAt?: string }>(x: T | null) => {
    if (!x) return x;
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = x;
    return rest;
  };

  seen.before = await a.get();
  seen.ensured = strip(await a.ensure({ displayName: "Ana" }));
  seen.ensuredAgain = strip(await a.ensure({ displayName: "Ignored" }));
  seen.updated = strip(await a.update({ displayName: "Ana R", settings: { theme: "dark", shuffle: "off" } }));
  seen.nameOnly = strip(await a.update({ displayName: "Ana" })); // settings untouched

  await a.createProfile(`${prefix}-p1`, { nickname: "Nova7", gradeBand: "3-5", color: "#4255ff", emoji: "🦊", showOnLeaderboard: false });
  await a.createProfile(`${prefix}-p2`, { nickname: "StarCat", gradeBand: null, color: "#128a5a", emoji: "🐼", showOnLeaderboard: true });
  seen.list = (await a.listProfiles()).map(strip);

  seen.patchSome = strip(await a.updateProfile(`${prefix}-p1`, { showOnLeaderboard: true }));
  seen.clearGrade = strip(await a.updateProfile(`${prefix}-p1`, { gradeBand: null }));
  seen.keepGrade = strip(await a.updateProfile(`${prefix}-p2`, { nickname: "StarCat2" }));

  // Isolation: B can't see or change A's profiles.
  await b.ensure({ displayName: "Ben" });
  seen.bList = await b.listProfiles();
  seen.bGet = await b.getProfile(`${prefix}-p1`);
  seen.bUpdate = await b.updateProfile(`${prefix}-p1`, { nickname: "Hacked" });
  seen.bDelete = await b.deleteProfile(`${prefix}-p1`);
  seen.aStill = strip(await a.getProfile(`${prefix}-p1`));

  // Decks and their kid assignments.
  const deck = { title: "Planets", description: null, cardCount: 2, yaml: "cards: []", enabled: true };
  seen.deckAll = strip(await a.createDeck(`${prefix}-d1`, { ...deck, profileIds: null }));
  seen.deckSome = strip(
    await a.createDeck(`${prefix}-d2`, { ...deck, title: "Moons", description: "Small", profileIds: [`${prefix}-p1`, `${prefix}-p1`, "ghost"] }),
  );
  seen.deckPatch = strip(await a.updateDeck(`${prefix}-d1`, { title: "Planets 2", enabled: false, profileIds: [`${prefix}-p2`, `${prefix}-p1`] }));
  seen.deckNarrow = strip(await a.updateDeck(`${prefix}-d1`, { profileIds: [`${prefix}-p2`] }));
  seen.deckKeep = strip(await a.updateDeck(`${prefix}-d2`, { title: "Moons 2" })); // assignments untouched
  seen.deckMissing = await a.updateDeck(`${prefix}-nope`, { title: "x" });
  seen.decks = (await a.listDecks()).map(strip);
  seen.bDecks = await b.listDecks();
  seen.bDeck = await b.getDeck(`${prefix}-d1`);
  seen.bDeckUpdate = await b.updateDeck(`${prefix}-d1`, { title: "Hacked" });
  seen.bDeckDelete = await b.deleteDeck(`${prefix}-d2`);
  seen.bDeckForAKid = strip(await b.createDeck(`${prefix}-bd`, { ...deck, profileIds: [`${prefix}-p1`] }));

  // Files: an upload is reserved first, then confirmed with its real size.
  const U0 = "2026-11-15T12:00:00.000Z";
  const U1 = "2026-11-15T12:15:00.000Z";
  const file = { pathname: `users/${prefix}-a/uploads/f1/a.pdf`, name: "a.pdf", contentType: "application/pdf", size: 2000 };
  seen.started = strip(await a.startUpload(`${prefix}-f1`, file, U0, U1));
  seen.samePath = await b.startUpload(`${prefix}-f2`, file, U0, U1).then(() => "saved", () => "rejected");
  seen.sameId = await a.startUpload(`${prefix}-f1`, { ...file, pathname: `${file.pathname}x` }, U0, U1).then(() => "saved", () => "rejected");
  seen.pendingNotListed = { files: await a.listFiles(), file: await a.getFile(`${prefix}-f1`) };
  seen.pending = strip(await a.getUpload(`${prefix}-f1`));
  seen.usageWhilePending = await a.fileUsage(U0);
  seen.usageOnceExpired = await a.fileUsage(U1);
  seen.bUpload = await b.getUpload(`${prefix}-f1`);
  seen.bComplete = await b.completeUpload(`${prefix}-f1`, { name: "b.pdf", size: 1 }, U0);
  seen.completeTooLate = await a.completeUpload(`${prefix}-f1`, { name: "a.pdf", size: 1234 }, U1);
  seen.file = strip(await a.completeUpload(`${prefix}-f1`, { name: "A.pdf", size: 1234 }, U0));
  seen.completeTwice = await a.completeUpload(`${prefix}-f1`, { name: "a.pdf", size: 1 }, U0);
  seen.noLongerPending = await a.getUpload(`${prefix}-f1`);
  seen.usageSaved = await a.fileUsage(U1); // a saved file counts for good
  await a.startUpload(`${prefix}-f4`, { ...file, pathname: `${file.pathname}4`, size: 10 }, U0, U1);
  seen.notExpiredYet = await a.expiredUploads(U0);
  seen.expiredUploads = (await a.expiredUploads(U1)).map(strip);
  seen.bExpired = await b.expiredUploads(U1);
  seen.sweptRecord = strip(await a.deleteFile(`${prefix}-f4`));
  seen.files = (await a.listFiles()).map(strip);
  seen.bFiles = await b.listFiles();
  seen.bFile = await b.getFile(`${prefix}-f1`);
  seen.bFileDelete = await b.deleteFile(`${prefix}-f1`);

  // Kid device links (looked up by secret fingerprints, outside any account).
  const T0 = "2026-11-15T12:00:00.000Z";
  const T1 = "2026-11-22T12:00:00.000Z";
  const T2 = "2026-11-15T13:30:00.000Z";
  /** When the device links made here stop working. */
  const T9 = "2027-05-14T12:00:00.000Z";
  seen.invite = await a.createInvite(`${prefix}-p1`, `${prefix}-h1`, T0, T1);
  seen.inviteAgain = await a.createInvite(`${prefix}-p1`, `${prefix}-h2`, T0, T1);
  seen.replacedGone = await db.findInvite(`${prefix}-h1`, T0);
  seen.open = await db.findInvite(`${prefix}-h2`, T0);
  seen.expired = await db.findInvite(`${prefix}-h2`, T1);
  seen.invitesA = await a.listInvites(T0);
  seen.invitesB = await b.listInvites(T0);
  seen.bInviteForA = await b.createInvite(`${prefix}-p1`, `${prefix}-hb`, T0, T1).then(() => "saved", () => "rejected");
  seen.redeemed = await db.redeemInvite(`${prefix}-h2`, T0, { id: `${prefix}-dev1`, tokenHash: `${prefix}-dh1`, label: "iPad · Safari", expiresAt: T9 });
  seen.redeemTwice = await db.redeemInvite(`${prefix}-h2`, T0, { id: `${prefix}-dev2`, tokenHash: `${prefix}-dh2`, label: "x", expiresAt: T9 });
  seen.invitesAfterUse = await a.listInvites(T0);
  seen.device = await db.findDevice(`${prefix}-dh1`, T2);
  seen.devices = await a.listDevices(T2); // last seen refreshed to T2
  seen.bDevices = await b.listDevices(T2);
  seen.bDeleteDevice = await b.deleteDevice(`${prefix}-dev1`);
  seen.deviceAtExpiry = await db.findDevice(`${prefix}-dh1`, T9);
  seen.devicesAtExpiry = await a.listDevices(T9);
  seen.deviceJustBefore = await db.findDevice(`${prefix}-dh1`, "2027-05-14T11:59:59.999Z");
  await a.createInvite(`${prefix}-p2`, `${prefix}-h3`, T0, T1);
  await db.redeemInvite(`${prefix}-h3`, T0, { id: `${prefix}-dev3`, tokenHash: `${prefix}-dh3`, label: "Mac · Chrome", expiresAt: T9 });
  seen.kidUnlinks = await db.removeDevice(`${prefix}-dh3`);
  seen.kidUnlinksAgain = await db.removeDevice(`${prefix}-dh3`);
  await a.createInvite(`${prefix}-p2`, `${prefix}-h4`, T0, T1);
  await db.redeemInvite(`${prefix}-h4`, T0, { id: `${prefix}-dev4`, tokenHash: `${prefix}-dh4`, label: "Mac · Chrome", expiresAt: T9 });
  seen.cancel = await a.cancelInvites(`${prefix}-p1`);
  seen.cancelNone = await a.cancelInvites(`${prefix}-p1`);

  seen.deleted = await a.deleteProfile(`${prefix}-p2`);
  seen.p2DeviceAfterProfileDeleted = await db.findDevice(`${prefix}-dh4`, T2);
  seen.decksAfterKidDeleted = (await a.listDecks()).map((d) => d.profileIds);
  seen.deckBackToAll = strip(await a.updateDeck(`${prefix}-d1`, { profileIds: null }));
  seen.fileDeleted = strip(await a.deleteFile(`${prefix}-f1`));
  seen.fileGone = await a.getFile(`${prefix}-f1`);
  await a.startUpload(`${prefix}-f3`, { ...file, pathname: `${file.pathname}3` }, U0, U1);
  seen.removedIds = await a.remove();
  seen.afterRemove = { account: await a.get(), profiles: await a.listProfiles(), decks: await a.listDecks(), files: await a.listFiles() };
  seen.deviceAfterRemove = await db.findDevice(`${prefix}-dh1`, T2);
  seen.bAfter = strip(await b.get());
  return JSON.parse(JSON.stringify(seen).replaceAll(prefix, "X"));
}

describe("Postgres accounts (PGlite)", () => {
  it("behaves exactly like the memory version, including isolation", async () => {
    const memory = await scenario(new MemoryAccounts(), "mem");
    const postgres = await scenario(new PostgresAccounts(sqlFor(pg)), "pg");
    expect(postgres).toEqual(memory);

    // Spot-check the important outcomes.
    expect(postgres.bList).toEqual([]);
    expect(postgres.bUpdate).toBeNull();
    expect(postgres.bDelete).toBe(false);
    expect(postgres.aStill).toMatchObject({ nickname: "Nova7", showOnLeaderboard: true, gradeBand: null });
    expect(postgres.keepGrade).toMatchObject({ nickname: "StarCat2", gradeBand: null });
    expect(postgres.nameOnly).toMatchObject({ displayName: "Ana", settings: { theme: "dark", shuffle: "off" } });
    expect(postgres.removedIds).toEqual(["X-p1"]);
    expect(postgres.deckSome).toMatchObject({ profileIds: ["X-p1"] });
    expect(postgres.deckNarrow).toMatchObject({ title: "Planets 2", enabled: false, profileIds: ["X-p2"] });
    expect(postgres.deckKeep).toMatchObject({ title: "Moons 2", profileIds: ["X-p1"] });
    expect(postgres.bDecks).toEqual([]);
    expect(postgres.bDeckUpdate).toBeNull();
    expect(postgres.bDeckDelete).toBe(false);
    expect(postgres.bDeckForAKid).toMatchObject({ profileIds: [] });
    expect(postgres.started).toMatchObject({ id: "X-f1", size: 2000, expiresAt: "2026-11-15T12:15:00.000Z" });
    expect(postgres.samePath).toBe("rejected");
    expect(postgres.sameId).toBe("rejected");
    expect(postgres.pendingNotListed).toEqual({ files: [], file: null });
    expect(postgres.usageWhilePending).toEqual({ count: 1, bytes: 2000 });
    expect(postgres.usageOnceExpired).toEqual({ count: 0, bytes: 0 });
    expect(postgres.bUpload).toBeNull();
    expect(postgres.bComplete).toBeNull();
    expect(postgres.completeTooLate).toBeNull();
    expect(postgres.file).toEqual({ id: "X-f1", name: "A.pdf", contentType: "application/pdf", size: 1234, pathname: "users/X-a/uploads/f1/a.pdf" });
    expect(postgres.completeTwice).toBeNull();
    expect(postgres.noLongerPending).toBeNull();
    expect(postgres.usageSaved).toEqual({ count: 1, bytes: 1234 });
    expect(postgres.notExpiredYet).toEqual([]);
    expect(postgres.expiredUploads).toMatchObject([{ id: "X-f4", pathname: "users/X-a/uploads/f1/a.pdf4" }]);
    expect(postgres.bExpired).toEqual([]);
    expect(postgres.files).toMatchObject([{ id: "X-f1" }]);
    expect(postgres.bFile).toBeNull();
    expect(postgres.bFileDelete).toBeNull();
    expect(postgres.decksAfterKidDeleted).toEqual([[], ["X-p1"]]);
    expect(postgres.afterRemove).toEqual({ account: null, profiles: [], decks: [], files: [] });
    expect(postgres.replacedGone).toBeNull();
    expect(postgres.open).toEqual({ accountId: "X-a", profileId: "X-p1", expiresAt: "2026-11-22T12:00:00.000Z" });
    expect(postgres.expired).toBeNull();
    expect(postgres.invitesB).toEqual([]);
    expect(postgres.bInviteForA).toBe("rejected");
    expect(postgres.redeemed).toEqual({ accountId: "X-a", profileId: "X-p1" });
    expect(postgres.redeemTwice).toBeNull();
    expect(postgres.invitesAfterUse).toEqual([]);
    expect(postgres.devices).toMatchObject([
      { id: "X-dev1", profileId: "X-p1", label: "iPad · Safari", lastSeenAt: "2026-11-15T13:30:00.000Z", expiresAt: "2027-05-14T12:00:00.000Z" },
    ]);
    expect(postgres.bDevices).toEqual([]);
    expect(postgres.bDeleteDevice).toBe(false);
    expect(postgres.deviceAtExpiry).toBeNull();
    expect(postgres.devicesAtExpiry).toEqual([]);
    expect(postgres.deviceJustBefore).toEqual({ id: "X-dev1", accountId: "X-a", profileId: "X-p1" });
    expect(postgres.kidUnlinks).toEqual({ id: "X-dev3", accountId: "X-a", profileId: "X-p2" });
    expect(postgres.kidUnlinksAgain).toBeNull();
    expect(postgres.cancel).toBe(true);
    expect(postgres.cancelNone).toBe(false);
    expect(postgres.p2DeviceAfterProfileDeleted).toBeNull();
    expect(postgres.deviceAfterRemove).toBeNull();
  });

  it("refuses to assign a deck to another account's kid at the database too", async () => {
    const db = new PostgresAccounts(sqlFor(pg));
    const a = db.forAccount("fk-a");
    const b = db.forAccount("fk-b");
    await a.ensure({ displayName: "A" });
    await b.ensure({ displayName: "B" });
    await a.createDeck("fk-deck", { title: "T", description: null, cardCount: 1, yaml: "y", enabled: true, profileIds: null });
    await b.createProfile("fk-kid", { nickname: "K", gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false });
    await expect(
      pg.query("insert into deck_assignments (account_id, deck_id, profile_id) values ('fk-a', 'fk-deck', 'fk-kid')"),
    ).rejects.toThrow();
    await expect(
      pg.query("insert into deck_assignments (account_id, deck_id, profile_id) values ('fk-b', 'fk-deck', 'fk-kid')"),
    ).rejects.toThrow();
  });

  it("gives rows from before the new columns sensible values", async () => {
    // As the earlier schema wrote them: a file with no status, a device with no expiry.
    const old = new PGlite();
    const dir = new URL("../db/migrations/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files.filter((f) => f < "004")) await old.exec(readFileSync(new URL(file, dir), "utf8"));
    await old.exec(`
      insert into accounts (id, display_name) values ('old-a', 'Ana');
      insert into kid_profiles (id, account_id, nickname, color, emoji) values ('old-p', 'old-a', 'Nova7', '#4255ff', '🦊');
      insert into files (id, account_id, pathname, name, content_type, size_bytes) values ('old-f', 'old-a', 'users/old-a/uploads/old-f/a.pdf', 'a.pdf', 'application/pdf', 99);
      insert into kid_devices (id, token_hash, account_id, profile_id, label, created_at, last_seen_at)
        values ('old-d', 'old-hash', 'old-a', 'old-p', 'iPad · Safari', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z');`);
    for (const file of files.filter((f) => f >= "004")) await old.exec(readFileSync(new URL(file, dir), "utf8"));

    const db = new PostgresAccounts(sqlFor(old));
    const a = db.forAccount("old-a");
    expect(await a.listFiles()).toMatchObject([{ id: "old-f", size: 99 }]); // a saved file, as before
    expect(await a.fileUsage("2030-01-01T00:00:00.000Z")).toEqual({ count: 1, bytes: 99 });
    expect(await a.listDevices("2026-11-18T00:00:00.000Z")).toMatchObject([{ id: "old-d", expiresAt: "2027-03-30T00:00:00.000Z" }]); // 180 days after it was linked
    expect(await db.findDevice("old-hash", "2027-03-30T00:00:00.000Z")).toBeNull();
    await old.close();
  });

  it("rejects an unknown grade band at the database too", async () => {
    const db = new PostgresAccounts(sqlFor(pg)).forAccount("grade-check");
    await db.ensure({ displayName: "G" });
    await expect(
      db.createProfile("g1", { nickname: "Z", gradeBand: "college" as never, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false }),
    ).rejects.toThrow();
  });
});


/**
 * Requests racing at a limit must end with exactly the maximum number of rows.
 * (PGlite runs one statement at a time, so here this proves each limit is
 * enforced by the insert itself; the PostgreSQL service suite below repeats it
 * with requests that truly overlap.)
 */
async function racesAtTheLimit(db: AccountsDb, prefix: string) {
  const account = db.forAccount(`${prefix}-race`);
  await account.ensure({ displayName: "Race" });
  const profile = { nickname: "Kid", gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false };
  const deck = { title: "T", description: null, cardCount: 1, yaml: "y", enabled: true, profileIds: null };
  const NOW = "2026-11-15T12:00:00.000Z";
  const LATER = "2026-11-15T12:15:00.000Z";
  const upload = (i: number, size: number) => ({ pathname: `users/${prefix}-race/uploads/f${i}/a.pdf`, name: "a.pdf", contentType: "application/pdf", size });
  const extra = 6;

  const profiles = await Promise.all(Array.from({ length: MAX_PROFILES + extra }, (_, i) => account.createProfile(`${prefix}-rp${i}`, profile)));
  const decks = await Promise.all(Array.from({ length: MAX_DECKS + extra }, (_, i) => account.createDeck(`${prefix}-rd${i}`, deck)));
  const files = await Promise.all(Array.from({ length: MAX_FILES + extra }, (_, i) => account.startUpload(`${prefix}-rf${i}`, upload(i, 10), NOW, LATER)));

  // The byte total is a limit of its own: 50 MB holds seven 7 MB uploads, not eight.
  const bytes = db.forAccount(`${prefix}-bytes`);
  await bytes.ensure({ displayName: "Bytes" });
  const seven = 7 * 1024 * 1024;
  const big = await Promise.all(Array.from({ length: 12 }, (_, i) => bytes.startUpload(`${prefix}-rb${i}`, { ...upload(i, seven), pathname: `users/${prefix}-bytes/uploads/b${i}/a.pdf` }, NOW, LATER)));

  return {
    profilesCreated: profiles.filter(Boolean).length,
    profilesRefused: profiles.filter((p) => p === null).length,
    profileRows: (await account.listProfiles()).length,
    decksCreated: decks.filter(Boolean).length,
    deckRows: (await account.listDecks()).length,
    uploadsStarted: files.filter(Boolean).length,
    fileUsage: await account.fileUsage(NOW),
    bigStarted: big.filter(Boolean).length,
    bigUsage: await bytes.fileUsage(NOW),
  };
}

const AT_THE_LIMIT = {
  profilesCreated: MAX_PROFILES,
  profilesRefused: 6,
  profileRows: MAX_PROFILES,
  decksCreated: MAX_DECKS,
  deckRows: MAX_DECKS,
  uploadsStarted: MAX_FILES,
  fileUsage: { count: MAX_FILES, bytes: MAX_FILES * 10 },
  bigStarted: Math.floor(MAX_TOTAL_FILE_BYTES / (7 * 1024 * 1024)),
  bigUsage: { count: 7, bytes: 7 * 7 * 1024 * 1024 },
};

describe("limits are enforced inside the insert", () => {
  it("parallel creates at the limit end with exactly the maximum number of rows (memory)", async () => {
    expect(await racesAtTheLimit(new MemoryAccounts(), "mem")).toEqual(AT_THE_LIMIT);
  });

  it("parallel creates at the limit end with exactly the maximum number of rows (Postgres)", async () => {
    expect(await racesAtTheLimit(new PostgresAccounts(sqlFor(pg)), "pg")).toEqual(AT_THE_LIMIT);
  });
});

// This suite only targets the explicitly created disposable container; it never
// uses DATABASE_URL, which might point to the user's real account data.
const disposablePgUrl = process.env.QUIZZLET_DISPOSABLE_PG === "1" ? process.env.QUIZZLET_TEST_PG_URL : undefined;
describe.skipIf(!disposablePgUrl)("Postgres accounts (isolated PostgreSQL service)", () => {
  let pool: pgDriver.Pool;
  beforeAll(async () => {
    pool = new pgDriver.Pool({ connectionString: disposablePgUrl, max: 20 });
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(new URL(file, dir), "utf8"));
    }
  });
  afterAll(async () => { await pool?.end(); });
  it("matches memory for accounts, private decks, devices, visibility and deletion", async () => {
    const store = new PostgresAccounts(sqlForPool(pool));
    expect(await scenario(store, "pgservice")).toEqual(await scenario(new MemoryAccounts(), "memservice"));
  });
  it("holds every limit when the requests truly run at the same time", async () => {
    expect(await racesAtTheLimit(new PostgresAccounts(sqlForPool(pool)), "pgservice")).toEqual(AT_THE_LIMIT);
  }, 60000);
});
