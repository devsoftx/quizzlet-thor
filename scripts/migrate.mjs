// Applies db/migrations/*.sql in order, once each (see migrations.mjs).
//
// Migrations need a role that may create tables, functions and triggers. The
// running app doesn't: give it a least-privilege role in DATABASE_URL and keep
// the owner connection in DATABASE_URL_MIGRATIONS, used only here
// (see docs/security/runbook.md). Without it, DATABASE_URL is used.
// Usage: DATABASE_URL_MIGRATIONS=... npm run db:migrate
//
// --deploy is the build's step (`npm run db:migrate:deploy`, from vercel.json's
// buildCommand). It runs after the app has built, and only for production
// deployments; previews and local builds skip it. If a migration fails, the
// build fails and the new code doesn't go live on a schema it doesn't match.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { deployMigrationPlan, migrate } from "./migrations.mjs";

if (process.argv.includes("--deploy")) {
  const plan = deployMigrationPlan(process.env);
  if (!plan.run && plan.fail) {
    console.error(`Not migrating: ${plan.reason}.`);
    process.exit(1);
  }
  if (!plan.run) {
    console.log(`Skipping migrations: ${plan.reason}.`);
    process.exit(0);
  }
}

const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) to the database to migrate.");
  process.exit(1);
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
await migrate(neon(url), dir);
