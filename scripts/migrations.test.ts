// The migration runner (scripts/migrations.mjs) against PGlite, an in-process
// Postgres, through an adapter shaped like neon's `sql`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { deployMigrationPlan, migrate, recordedByAnotherRun, type MigrationSql } from "./migrations.mjs";

type Rows = Record<string, unknown>[];
interface Query extends PromiseLike<Rows> {
  text: string;
  values: unknown[];
}

/** neon's `sql` over PGlite: queries run when awaited, and `transaction` runs a list atomically. */
function neonLike(db: PGlite, beforeTransaction?: () => Promise<void>) {
  const transactions: string[][] = [];
  const make = (text: string, values: unknown[] = []): Query => ({
    text,
    values,
    then: (onFulfilled, onRejected) => db.query(text, values).then((r) => r.rows as Rows).then(onFulfilled, onRejected),
  });
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => (text += `$${i + 1}${strings[i + 1]}`));
    return make(text, values);
  }) as MigrationSql;
  sql.query = (text) => make(text);
  sql.transaction = async (queries) => {
    await beforeTransaction?.();
    const list = queries as Query[];
    transactions.push(list.map((q) => q.text));
    return db.transaction(async (tx) => {
      for (const q of list) await tx.query(q.text, q.values);
    });
  };
  return { sql, transactions };
}

const open: PGlite[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function database() {
  const db = new PGlite();
  open.push(db);
  return db;
}

function migrationsDir(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "quizzlet-migrations-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const recorded = async (db: PGlite) =>
  (await db.query<{ name: string }>("select name from schema_migrations order by name")).rows.map((r) => r.name);
const tableExists = async (db: PGlite, name: string) =>
  (await db.query<{ found: boolean }>("select to_regclass($1) is not null as found", [name])).rows[0].found;

describe("migrate", () => {
  it("applies new files in order, each in one transaction that records the file first", async () => {
    const db = database();
    const { sql, transactions } = neonLike(db);
    const dir = migrationsDir({
      "002_b.sql": "create table b (id int primary key);",
      "001_a.sql": "create table a (id int primary key);\ninsert into a values (1);",
    });
    const log: string[] = [];

    expect(await migrate(sql, dir, (line) => log.push(line))).toEqual(["001_a.sql", "002_b.sql"]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0][0]).toMatch(/^insert into schema_migrations/);
    expect(transactions[0].slice(1)).toEqual(["create table a (id int primary key)", "insert into a values (1)"]);
    expect(await recorded(db)).toEqual(["001_a.sql", "002_b.sql"]);
    expect(log).toEqual(["+ 001_a.sql (2 statements)", "+ 002_b.sql (1 statements)", "Migrations up to date."]);

    log.length = 0;
    expect(await migrate(sql, dir, (line) => log.push(line))).toEqual([]);
    expect(log).toEqual(["= 001_a.sql (already applied)", "= 002_b.sql (already applied)", "Migrations up to date."]);
  });

  it("skips a file another run applied at the same moment, then carries on", async () => {
    const db = database();
    let raced = false;
    // Another run commits 001 after this one read the list but before its transaction.
    const { sql } = neonLike(db, async () => {
      if (raced) return;
      raced = true;
      await db.exec("insert into schema_migrations (name) values ('001_a.sql'); create table a (id int primary key);");
    });
    const dir = migrationsDir({
      "001_a.sql": "create table a (id int primary key);",
      "002_b.sql": "create table b (id int primary key);",
    });
    const log: string[] = [];

    expect(await migrate(sql, dir, (line) => log.push(line))).toEqual(["002_b.sql"]);
    expect(log).toContain("= 001_a.sql (applied by another run)");
    expect(await recorded(db)).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("stops at a failing file, leaving it unapplied and unrecorded", async () => {
    const db = database();
    const { sql } = neonLike(db);
    const dir = migrationsDir({
      "001_a.sql": "create table a (id int primary key);",
      "002_c.sql": "create table c (id int primary key);\ninsert into no_such_table values (1);",
      "003_d.sql": "create table d (id int primary key);",
    });

    await expect(migrate(sql, dir, () => {})).rejects.toThrow(/no_such_table/);
    expect(await recorded(db)).toEqual(["001_a.sql"]);
    expect(await tableExists(db, "c")).toBe(false);
    expect(await tableExists(db, "d")).toBe(false);
  });

  it("applies the real db/migrations once", async () => {
    const db = database();
    const { sql } = neonLike(db);
    const dir = fileURLToPath(new URL("../db/migrations/", import.meta.url));

    const applied = await migrate(sql, dir, () => {});
    expect(applied.length).toBeGreaterThanOrEqual(6);
    expect(await recorded(db)).toEqual(applied);
    expect(await tableExists(db, "file_reservations")).toBe(true);
    expect(await migrate(sql, dir, () => {})).toEqual([]);
  });
});

describe("recordedByAnotherRun", () => {
  it("is true only for a duplicate row in schema_migrations", () => {
    expect(recordedByAnotherRun({ code: "23505", constraint: "schema_migrations_pkey" })).toBe(true);
    expect(recordedByAnotherRun({ code: "23505", message: 'duplicate key value violates unique constraint "schema_migrations_pkey"' })).toBe(true);
    expect(recordedByAnotherRun({ code: "23505", constraint: "accounts_pkey" })).toBe(false);
    expect(recordedByAnotherRun({ code: "42P01", message: "schema_migrations_pkey" })).toBe(false);
    expect(recordedByAnotherRun(new Error("network"))).toBe(false);
    expect(recordedByAnotherRun(undefined)).toBe(false);
  });
});

describe("migrating on deploy", () => {
  it("runs for production deployments only", () => {
    expect(deployMigrationPlan({ VERCEL: "1", VERCEL_ENV: "production" })).toEqual({ run: true });
    for (const env of [{ VERCEL: "1", VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "development" }, {}]) {
      const plan = deployMigrationPlan(env);
      expect(plan).toMatchObject({ run: false, fail: false });
      expect(plan.run === false && plan.reason).toContain(env.VERCEL_ENV ?? "not set");
    }
  });

  it("fails a Vercel build that doesn't say which environment it's for", () => {
    expect(deployMigrationPlan({ VERCEL: "1" })).toMatchObject({ run: false, fail: true });
  });

  it("is part of the Vercel build, after the app builds", () => {
    const root = new URL("../", import.meta.url);
    const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));
    const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    expect(vercel.buildCommand).toBe("npm run build && npm run db:migrate:deploy");
    expect(pkg.scripts["db:migrate:deploy"]).toBe("node scripts/migrate.mjs --deploy");
  });
});
