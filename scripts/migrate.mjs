// Applies db/migrations/*.sql in order, once each, to the database in DATABASE_URL.
// Usage: DATABASE_URL=... npm run db:migrate
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
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
  const statements = readFileSync(path.join(dir, file), "utf8")
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
  // One transaction per file, recorded together with the file name.
  await sql.transaction([
    ...statements.map((s) => sql.query(s)),
    sql`insert into schema_migrations (name) values (${file})`,
  ]);
  console.log(`+ ${file} (${statements.length} statements)`);
}
console.log("Migrations up to date.");
