// Applying db/migrations/*.sql: shared by `npm run db:migrate` and the
// production build's migration step (scripts/migrate.mjs).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { splitSql } from "./sql-split.mjs";

/**
 * Whether a build should migrate. Only production deployments migrate:
 * preview deployments have no database, and must never change production's
 * schema with a migration that hasn't been merged. A Vercel build that doesn't
 * say which environment it's for fails instead: skipping quietly there could
 * put new code live on an old schema.
 */
export function deployMigrationPlan(env) {
  if (env.VERCEL_ENV === "production") return { run: true };
  if (env.VERCEL && !env.VERCEL_ENV) {
    return { run: false, fail: true, reason: "this Vercel build has no VERCEL_ENV, so it can't tell whether it's production" };
  }
  return { run: false, fail: false, reason: `not a production deployment (VERCEL_ENV is ${env.VERCEL_ENV ?? "not set"})` };
}

/** True when the error is another run having recorded the same migration first. */
export function recordedByAnotherRun(error) {
  if (error?.code !== "23505") return false;
  return error.constraint === "schema_migrations_pkey" || String(error.message).includes("schema_migrations_pkey");
}

/**
 * Applies every file in `dir` that schema_migrations doesn't list, in name
 * order, one transaction per file. Returns the files it applied.
 *
 * Each transaction records the file first. Two runs at the same moment (a deploy
 * and a manual `npm run db:migrate`) can't both apply it: the second waits on the
 * first one's row, then fails on the primary key and skips the file.
 */
export async function migrate(sql, dir, log = console.log) {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const added = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) {
      log(`= ${file} (already applied)`);
      continue;
    }
    const statements = splitSql(readFileSync(path.join(dir, file), "utf8"));
    try {
      await sql.transaction([
        sql`insert into schema_migrations (name) values (${file})`,
        ...statements.map((s) => sql.query(s)),
      ]);
    } catch (error) {
      if (!recordedByAnotherRun(error)) throw error;
      log(`= ${file} (applied by another run)`);
      continue;
    }
    added.push(file);
    log(`+ ${file} (${statements.length} statements)`);
  }
  log("Migrations up to date.");
  return added;
}
