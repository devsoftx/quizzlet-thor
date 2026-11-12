// Runs the real migration and the Postgres account code against PGlite (an
// in-process Postgres), checking it behaves exactly like the memory version.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { beforeAll, describe, expect, it } from "vitest";
import { MemoryAccounts, PostgresAccounts, type AccountsDb } from "./accounts.js";

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

  // Files.
  const file = { pathname: `users/${prefix}-a/uploads/f1/a.pdf`, name: "a.pdf", contentType: "application/pdf", size: 1234 };
  seen.file = strip(await a.createFile(`${prefix}-f1`, file));
  seen.samePath = await b.createFile(`${prefix}-f2`, file).then(() => "saved", () => "rejected");
  seen.files = (await a.listFiles()).map(strip);
  seen.bFiles = await b.listFiles();
  seen.bFile = await b.getFile(`${prefix}-f1`);
  seen.bFileDelete = await b.deleteFile(`${prefix}-f1`);

  seen.deleted = await a.deleteProfile(`${prefix}-p2`);
  seen.decksAfterKidDeleted = (await a.listDecks()).map((d) => d.profileIds);
  seen.deckBackToAll = strip(await a.updateDeck(`${prefix}-d1`, { profileIds: null }));
  seen.fileDeleted = strip(await a.deleteFile(`${prefix}-f1`));
  seen.fileGone = await a.getFile(`${prefix}-f1`);
  await a.createFile(`${prefix}-f3`, { ...file, pathname: `${file.pathname}3` });
  seen.removedIds = await a.remove();
  seen.afterRemove = { account: await a.get(), profiles: await a.listProfiles(), decks: await a.listDecks(), files: await a.listFiles() };
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
    expect(postgres.samePath).toBe("rejected");
    expect(postgres.bFile).toBeNull();
    expect(postgres.bFileDelete).toBeNull();
    expect(postgres.decksAfterKidDeleted).toEqual([[], ["X-p1"]]);
    expect(postgres.afterRemove).toEqual({ account: null, profiles: [], decks: [], files: [] });
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

  it("rejects an unknown grade band at the database too", async () => {
    const db = new PostgresAccounts(sqlFor(pg)).forAccount("grade-check");
    await db.ensure({ displayName: "G" });
    await expect(
      db.createProfile("g1", { nickname: "Z", gradeBand: "college" as never, color: "#4255ff", emoji: "🦊", showOnLeaderboard: false }),
    ).rejects.toThrow();
  });
});
