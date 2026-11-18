// Runs the real migration and the Postgres account code against PGlite (an
// in-process Postgres), checking it behaves exactly like the memory version.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pgDriver from "pg";
import {
  LimitReached,
  MAX_DECKS,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PROFILES,
  MAX_TOTAL_FILE_BYTES,
  MemoryAccounts,
  PostgresAccounts,
  type AccountsDb,
} from "./accounts.js";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dir = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(new URL(file, dir), "utf8"));
  }
});

/** Adapts PGlite to the tagged-template shape PostgresAccounts uses (neon's `sql`). */
function sqlFor(db: PGlite) {
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
    return (await db.query(text, values)).rows;
  };
  return tagged as unknown as NeonQueryFunction<false, false>;
}

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

  // Files: recorded by using up a live upload reservation, and in no other way.
  const R0 = "2026-11-15T12:00:00.000Z";
  const R1 = "2026-11-15T12:15:00.000Z";
  const file = { pathname: `users/${prefix}-a/uploads/f1/a.pdf`, name: "a.pdf", contentType: "application/pdf", size: 1234 };
  seen.unreserved = await a.saveUpload(`${prefix}-f1`, file, R0);
  await a.reserveUpload(file.pathname, file.size, R0, R1);
  seen.bSavesAsUpload = await b.saveUpload(`${prefix}-f2`, file, R0); // another account can't use it
  seen.tooLate = await a.saveUpload(`${prefix}-f1`, file, R1);
  seen.file = strip(await a.saveUpload(`${prefix}-f1`, file, R0));
  seen.savedTwice = await a.saveUpload(`${prefix}-f2`, file, R0);
  seen.samePath = await b.reserveUpload(file.pathname, file.size, R0, R1).then(() => "saved", () => "rejected");
  seen.files = (await a.listFiles()).map(strip);
  seen.bFiles = await b.listFiles();
  seen.bFile = await b.getFile(`${prefix}-f1`);
  seen.bFileDelete = await b.deleteFile(`${prefix}-f1`);

  // Upload reservations: live ones count against the quota; expired ones stay on record until
  // the cleanup has deleted what was uploaded for them.
  const R2 = "2026-11-15T12:30:00.000Z";
  const upload = (n: number) => `users/${prefix}-a/uploads/r${n}/a.pdf`;
  await a.reserveUpload(upload(1), 1000, R0, R1);
  await a.reserveUpload(upload(2), 2000, R0, R1);
  seen.reserved = await a.listReservations(R0);
  seen.reservedTwice = await a.reserveUpload(upload(1), 1000, R0, R1).then(() => "saved", () => "rejected");
  seen.bReservations = await b.listReservations(R0);
  seen.liveAtExpiry = await a.listReservations(R1);
  seen.notExpiredYet = await a.expiredUploads(R0, 10);
  seen.uploadsExpired = await a.expiredUploads(R1, 10);
  seen.uploadsExpiredLimited = await a.expiredUploads(R1, 1);
  seen.bExpired = await b.expiredUploads(R1, 10);
  seen.confirmed = strip(await a.saveUpload(`${prefix}-r1`, { ...file, pathname: upload(1) }, R0)); // uses up its reservation
  seen.reservedAfterConfirm = await a.listReservations(R0);
  seen.tooBig = await a
    .reserveUpload(upload(3), MAX_TOTAL_FILE_BYTES, R0, R1)
    .then(() => "saved", (err) => (err instanceof LimitReached ? err.kind : "error"));
  // A later reservation: the expired one no longer counts, but is still on record.
  await a.reserveUpload(upload(4), 10, R1, R2);
  seen.reservedLater = await a.listReservations(R1);
  seen.expiredLater = await a.expiredUploads(R1, 10);
  // The cleanup's view, across accounts: oldest first, and a record is only dropped once it has expired.
  seen.allExpired = await db.expiredReservations(R2, 10);
  seen.forgotLive = await db.forgetReservations([upload(4)], R1);
  seen.forgotten = await db.forgetReservations([upload(2), "users/nobody/uploads/x/a.pdf"], R1);
  seen.expiredAfterForgetting = await db.expiredReservations(R2, 10);
  await db.forgetReservations([upload(4)], R2);
  await a.deleteFile(`${prefix}-r1`);

  // Kid device links (looked up by secret fingerprints, outside any account).
  const T0 = "2026-11-15T12:00:00.000Z";
  const T1 = "2026-11-22T12:00:00.000Z";
  const T2 = "2026-11-15T13:30:00.000Z";
  seen.invite = await a.createInvite(`${prefix}-p1`, `${prefix}-h1`, T0, T1);
  seen.inviteAgain = await a.createInvite(`${prefix}-p1`, `${prefix}-h2`, T0, T1);
  seen.replacedGone = await db.findInvite(`${prefix}-h1`, T0);
  seen.open = await db.findInvite(`${prefix}-h2`, T0);
  seen.expired = await db.findInvite(`${prefix}-h2`, T1);
  seen.invitesA = await a.listInvites(T0);
  seen.invitesB = await b.listInvites(T0);
  seen.bInviteForA = await b.createInvite(`${prefix}-p1`, `${prefix}-hb`, T0, T1).then(() => "saved", () => "rejected");
  seen.redeemed = await db.redeemInvite(`${prefix}-h2`, T0, { id: `${prefix}-dev1`, tokenHash: `${prefix}-dh1`, label: "iPad · Safari" });
  seen.redeemTwice = await db.redeemInvite(`${prefix}-h2`, T0, { id: `${prefix}-dev2`, tokenHash: `${prefix}-dh2`, label: "x" });
  seen.invitesAfterUse = await a.listInvites(T0);
  seen.device = await db.findDevice(`${prefix}-dh1`, T2);
  seen.devices = await a.listDevices(); // last seen refreshed to T2
  seen.bDevices = await b.listDevices();
  seen.bDeleteDevice = await b.deleteDevice(`${prefix}-dev1`);
  await a.createInvite(`${prefix}-p2`, `${prefix}-h3`, T0, T1);
  await db.redeemInvite(`${prefix}-h3`, T0, { id: `${prefix}-dev3`, tokenHash: `${prefix}-dh3`, label: "Mac · Chrome" });
  seen.kidUnlinks = await db.removeDevice(`${prefix}-dh3`);
  await a.createInvite(`${prefix}-p2`, `${prefix}-h4`, T0, T1);
  await db.redeemInvite(`${prefix}-h4`, T0, { id: `${prefix}-dev4`, tokenHash: `${prefix}-dh4`, label: "Mac · Chrome" });
  seen.cancel = await a.cancelInvites(`${prefix}-p1`);
  seen.cancelNone = await a.cancelInvites(`${prefix}-p1`);

  seen.deleted = await a.deleteProfile(`${prefix}-p2`);
  seen.p2DeviceAfterProfileDeleted = await db.findDevice(`${prefix}-dh4`, T2);
  seen.decksAfterKidDeleted = (await a.listDecks()).map((d) => d.profileIds);
  seen.deckBackToAll = strip(await a.updateDeck(`${prefix}-d1`, { profileIds: null }));
  seen.fileDeleted = strip(await a.deleteFile(`${prefix}-f1`));
  seen.fileGone = await a.getFile(`${prefix}-f1`);
  await a.reserveUpload(`${file.pathname}3`, file.size, R0, R1);
  await a.saveUpload(`${prefix}-f3`, { ...file, pathname: `${file.pathname}3` }, R0);
  await a.reserveUpload(`${file.pathname}4`, file.size, R0, R1); // left behind: goes with the account
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
    expect(postgres.unreserved).toBeNull();
    expect(postgres.bSavesAsUpload).toBeNull();
    expect(postgres.tooLate).toBeNull();
    expect(postgres.file).toMatchObject({ id: "X-f1", pathname: "users/X-a/uploads/f1/a.pdf", size: 1234 });
    expect(postgres.savedTwice).toBeNull();
    expect(postgres.samePath).toBe("rejected"); // a path that holds a saved file can't be reserved again, by anyone
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
    expect(postgres.devices).toMatchObject([{ id: "X-dev1", profileId: "X-p1", label: "iPad · Safari", lastSeenAt: "2026-11-15T13:30:00.000Z" }]);
    expect(postgres.bDevices).toEqual([]);
    expect(postgres.bDeleteDevice).toBeNull();
    expect(postgres.kidUnlinks).toEqual({ id: "X-dev3", accountId: "X-a", profileId: "X-p2" });
    expect(postgres.reserved).toEqual([
      { pathname: "users/X-a/uploads/r1/a.pdf", declaredBytes: 1000, expiresAt: "2026-11-15T12:15:00.000Z" },
      { pathname: "users/X-a/uploads/r2/a.pdf", declaredBytes: 2000, expiresAt: "2026-11-15T12:15:00.000Z" },
    ]);
    expect(postgres.reservedTwice).toBe("rejected");
    expect(postgres.bReservations).toEqual([]);
    expect(postgres.liveAtExpiry).toEqual([]);
    expect(postgres.notExpiredYet).toEqual([]);
    expect(postgres.uploadsExpired).toEqual(["users/X-a/uploads/r1/a.pdf", "users/X-a/uploads/r2/a.pdf"]);
    expect(postgres.uploadsExpiredLimited).toEqual(["users/X-a/uploads/r1/a.pdf"]);
    expect(postgres.bExpired).toEqual([]);
    expect(postgres.reservedAfterConfirm).toMatchObject([{ pathname: "users/X-a/uploads/r2/a.pdf" }]);
    expect(postgres.tooBig).toBe("storage");
    expect(postgres.reservedLater).toMatchObject([{ pathname: "users/X-a/uploads/r4/a.pdf", declaredBytes: 10 }]);
    expect(postgres.expiredLater).toEqual(["users/X-a/uploads/r2/a.pdf"]);
    expect(postgres.allExpired).toEqual(["users/X-a/uploads/r2/a.pdf", "users/X-a/uploads/r4/a.pdf"]);
    expect(postgres.forgotLive).toBe(0);
    expect(postgres.forgotten).toBe(1);
    expect(postgres.expiredAfterForgetting).toEqual(["users/X-a/uploads/r4/a.pdf"]);
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

  // The limits are enforced where the row is inserted (triggers), not only by the handlers' checks.
  for (const [name, make] of [["Postgres", () => new PostgresAccounts(sqlFor(pg))], ["memory", () => new MemoryAccounts()]] as const) {
    it(`enforces the profile, deck, file and upload limits in the ${name} store`, async () => {
      const scope = make().forAccount(`limits-${name}`);
      await scope.ensure({ displayName: "L" });
      const refused = (work: Promise<unknown>) => work.then(() => "saved", (err) => (err instanceof LimitReached ? err.kind : `error: ${err}`));

      const profile = { nickname: "K", gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false };
      for (let i = 0; i < MAX_PROFILES; i++) await scope.createProfile(`${name}-p${i}`, profile);
      expect(await refused(scope.createProfile(`${name}-p-over`, profile))).toBe("profiles");
      expect(await scope.listProfiles()).toHaveLength(MAX_PROFILES);

      const deck = { title: "T", description: null, cardCount: 1, yaml: "y", enabled: true, profileIds: null };
      for (let i = 0; i < MAX_DECKS; i++) await scope.createDeck(`${name}-d${i}`, deck);
      expect(await refused(scope.createDeck(`${name}-d-over`, deck))).toBe("decks");
      expect(await scope.listDecks()).toHaveLength(MAX_DECKS);

      const T0 = "2026-11-15T12:00:00.000Z";
      const T1 = "2026-11-15T12:15:00.000Z";
      const path = (n: number | string) => `users/limits-${name}/uploads/u${n}/a.pdf`;
      const save = async (n: number | string, now = T0, until = T1) => {
        await scope.reserveUpload(path(n), 10, now, until);
        return scope.saveUpload(`${name}-${n}`, { pathname: path(n), name: "a.pdf", contentType: "application/pdf", size: 10 }, now);
      };
      // Half saved files, half started uploads: together they fill the file limit.
      for (let i = 0; i < MAX_FILES / 2; i++) {
        expect(await save(`f${i}`)).not.toBeNull();
        await scope.reserveUpload(path(i), 10, T0, T1);
      }
      expect(await refused(scope.reserveUpload(path("over"), 10, T0, T1))).toBe("files");
      // Once those reservations have run out there is room again, up to the limit of saved files and no further.
      const T2 = "2026-11-15T12:30:00.000Z";
      for (let i = MAX_FILES / 2; i < MAX_FILES; i++) expect(await save(`f${i}`, T1, T2)).not.toBeNull();
      expect(await refused(save("f-over", T1, T2))).toBe("files");
      expect(await scope.listFiles()).toHaveLength(MAX_FILES);
      // The expired reservations are still on record (for the cleanup), without counting.
      expect(await scope.expiredUploads(T1, 100)).toHaveLength(MAX_FILES / 2);
    });

    it(`counts started uploads' bytes against the storage total in the ${name} store`, async () => {
      const scope = make().forAccount(`bytes-${name}`);
      await scope.ensure({ displayName: "B" });
      const T0 = "2026-11-15T12:00:00.000Z";
      const T1 = "2026-11-15T12:15:00.000Z";
      const path = (n: number | string) => `users/bytes-${name}/uploads/u${n}/a.pdf`;
      const whole = Math.floor(MAX_TOTAL_FILE_BYTES / MAX_FILE_BYTES);
      for (let i = 0; i < whole; i++) await scope.reserveUpload(path(i), MAX_FILE_BYTES, T0, T1);
      const left = MAX_TOTAL_FILE_BYTES - whole * MAX_FILE_BYTES;
      await expect(scope.reserveUpload(path("over"), left + 1, T0, T1)).rejects.toMatchObject({ kind: "storage" });
      await scope.reserveUpload(path("exact"), left, T0, T1); // exactly full is allowed
    });
  }

  it("stops a file row going in past the limit even without a reservation (the trigger on files)", async () => {
    const scope = new PostgresAccounts(sqlFor(pg)).forAccount("files-trigger");
    await scope.ensure({ displayName: "F" });
    const insert = (n: number) =>
      pg.query("insert into files (id, account_id, pathname, name, content_type, size_bytes) values ($1, 'files-trigger', $2, 'a.pdf', 'application/pdf', 10)", [`ft-${n}`, `users/files-trigger/uploads/${n}/a.pdf`]);
    for (let i = 0; i < MAX_FILES; i++) await insert(i);
    await expect(insert(MAX_FILES)).rejects.toThrow(/quizzlet_limit:files/);
  });

  it("never treats a path with a saved file as an abandoned upload, even if a reservation row exists for it", async () => {
    const db = new PostgresAccounts(sqlFor(pg));
    const scope = db.forAccount("saved-path");
    await scope.ensure({ displayName: "S" });
    const pathname = "users/saved-path/uploads/u1/a.pdf";
    const T0 = "2026-11-15T12:00:00.000Z";
    const T1 = "2026-11-15T12:15:00.000Z";
    await scope.reserveUpload(pathname, 10, T0, T1);
    await scope.saveUpload("saved-f1", { pathname, name: "a.pdf", contentType: "application/pdf", size: 10 }, T0);
    // A row slipped in behind the trigger's back (it refuses this itself):
    await pg.query("alter table file_reservations disable trigger file_reservations_quota");
    await pg.query("insert into file_reservations (pathname, account_id, declared_bytes, created_at, expires_at) values ($1, 'saved-path', 10, $2, $3)", [pathname, T0, T1]);
    await pg.query("alter table file_reservations enable trigger file_reservations_quota");
    expect(await scope.expiredUploads("2026-11-16T12:00:00.000Z", 10)).toEqual([]);
    expect(await db.expiredReservations("2026-11-16T12:00:00.000Z", 1000)).not.toContain(pathname);
  });

  it("uses the same limits in the migrations as in the code", () => {
    const dir = new URL("../db/migrations/", import.meta.url);
    const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
    expect(sql).toContain(`quizzlet_enforce_limit('profiles', '${MAX_PROFILES}')`);
    expect(sql).toContain(`quizzlet_enforce_limit('decks', '${MAX_DECKS}')`);
    expect(sql).toContain(`quizzlet_enforce_limit('files', '${MAX_FILES}')`);
    expect(sql).toContain(`quizzlet_reserve_upload('${MAX_FILES}', '${MAX_TOTAL_FILE_BYTES}')`);
  });

  it("rejects an unknown grade band at the database too", async () => {
    const db = new PostgresAccounts(sqlFor(pg)).forAccount("grade-check");
    await db.ensure({ displayName: "G" });
    await expect(
      db.createProfile("g1", { nickname: "Z", gradeBand: "college" as never, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false }),
    ).rejects.toThrow();
  });
});


// This suite only targets the explicitly created disposable container; it never
// uses DATABASE_URL, which might point to the user's real account data.
const disposablePgUrl = process.env.QUIZZLET_DISPOSABLE_PG === "1" ? process.env.QUIZZLET_TEST_PG_URL : undefined;
describe.skipIf(!disposablePgUrl)("Postgres accounts (isolated PostgreSQL service)", () => {
  let pool: pgDriver.Pool;
  beforeAll(async () => {
    pool = new pgDriver.Pool({ connectionString: disposablePgUrl });
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(new URL(file, dir), "utf8"));
    }
  });
  afterAll(async () => { await pool?.end(); });
  it("matches memory for accounts, private decks, devices, visibility and deletion", async () => {
    const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
      return (await pool.query(text, values)).rows;
    };
    const store = new PostgresAccounts(tagged as unknown as NeonQueryFunction<false, false>);
    expect(await scenario(store, "pgservice")).toEqual(await scenario(new MemoryAccounts(), "memservice"));
  });

  // Many connections at once: without the triggers' account lock, parallel inserts
  // each read a count below the limit and all go in.
  const pooled = () => {
    const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
      return (await pool.query(text, values)).rows;
    };
    return new PostgresAccounts(tagged as unknown as NeonQueryFunction<false, false>);
  };
  const outcomes = async (work: Promise<unknown>[]) =>
    (await Promise.all(work.map((w) => w.then(() => "saved", (err) => (err instanceof LimitReached ? "limit" : `error: ${err}`))))).sort();

  it("10 parallel profile creations on an account with 19 leave exactly 20", async () => {
    const scope = pooled().forAccount("race-profiles");
    await scope.ensure({ displayName: "R" });
    const profile = { nickname: "K", gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false };
    for (let i = 0; i < MAX_PROFILES - 1; i++) await scope.createProfile(`race-p${i}`, profile);
    const results = await outcomes(Array.from({ length: 10 }, (_, i) => scope.createProfile(`race-p-extra${i}`, profile)));
    expect(results).toEqual([...new Array(9).fill("limit"), "saved"]);
    expect(await scope.listProfiles()).toHaveLength(MAX_PROFILES);
  });

  it("parallel deck creations stop at the deck limit", async () => {
    const scope = pooled().forAccount("race-decks");
    await scope.ensure({ displayName: "R" });
    const deck = { title: "T", description: null, cardCount: 1, yaml: "y", enabled: true, profileIds: null };
    const results = await outcomes(Array.from({ length: MAX_DECKS + 10 }, (_, i) => scope.createDeck(`race-d${i}`, deck)));
    expect(results.filter((r) => r === "saved")).toHaveLength(MAX_DECKS);
    expect(results.filter((r) => r === "limit")).toHaveLength(10);
    expect(await scope.listDecks()).toHaveLength(MAX_DECKS);
  });

  it("parallel upload starts stop at the file limit and the storage total", async () => {
    const T0 = "2026-11-15T12:00:00.000Z";
    const T1 = "2026-11-15T12:15:00.000Z";
    const count = pooled().forAccount("race-count");
    await count.ensure({ displayName: "R" });
    const byCount = await outcomes(Array.from({ length: MAX_FILES + 10 }, (_, i) => count.reserveUpload(`users/race-count/uploads/u${i}/a.pdf`, 10, T0, T1)));
    expect(byCount.filter((r) => r === "saved")).toHaveLength(MAX_FILES);
    expect(await count.listReservations(T0)).toHaveLength(MAX_FILES);

    const bytes = pooled().forAccount("race-bytes");
    await bytes.ensure({ displayName: "R" });
    const byBytes = await outcomes(Array.from({ length: 10 }, (_, i) => bytes.reserveUpload(`users/race-bytes/uploads/u${i}/a.pdf`, MAX_FILE_BYTES, T0, T1)));
    expect(byBytes.filter((r) => r === "saved")).toHaveLength(Math.floor(MAX_TOTAL_FILE_BYTES / MAX_FILE_BYTES));
  });
});
