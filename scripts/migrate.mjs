// Applies db/migrations/*.sql in order, once each.
//
// Migrations need a role that may create tables, functions and triggers. The
// running app doesn't: give it a least-privilege role in DATABASE_URL and keep
// the owner connection in DATABASE_URL_MIGRATIONS, used only here
// (see docs/security/runbook.md). Without it, DATABASE_URL is used.
// Usage: DATABASE_URL_MIGRATIONS=... npm run db:migrate
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { splitSql } from "./sql-split.mjs";

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) to the database to migrate.");
  process.exit(1);
}
const sql = neon(url);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) {
    console.log(`= ${file} (already applied)`);
    continue;
  }
  const statements = splitSql(readFileSync(path.join(dir, file), "utf8"));
  // One transaction per file, recorded together with the file name.
  await sql.transaction([
    ...statements.map((s) => sql.query(s)),
    sql`insert into schema_migrations (name) values (${file})`,
  ]);
  console.log(`+ ${file} (${statements.length} statements)`);
}
console.log("Migrations up to date.");
