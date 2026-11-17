// Run only against dedicated, disposable services; never fall back to DATABASE_URL
// or the application's normal Upstash settings.
import { existsSync, readdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (existsSync(".env.phase2.local")) process.loadEnvFile(".env.phase2.local");
const required = ["QUIZZLET_PHASE2_NEON_URL", "QUIZZLET_PHASE2_UPSTASH_URL", "QUIZZLET_PHASE2_UPSTASH_TOKEN"];
const missing = required.filter((name) => !process.env[name]);
if (process.env.QUIZZLET_PHASE2_ISOLATED !== "YES" || missing.length) {
  console.error("Dedicated test settings are required. Set QUIZZLET_PHASE2_ISOLATED=YES and the three QUIZZLET_PHASE2 service variables in .env.phase2.local.");
  if (missing.length) console.error(`Missing variable names: ${missing.join(", ")}`);
  process.exit(2);
}
// Read-only preflight: never apply migrations automatically to a remote database.
try {
  const sql = neon(process.env.QUIZZLET_PHASE2_NEON_URL);
  const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name));
  const pending = readdirSync("db/migrations").filter((name) => name.endsWith(".sql") && !applied.has(name));
  if (pending.length) {
    console.error(`The isolated Neon database is missing ${pending.length} project migration(s). Apply them to the dedicated test database before running.`);
    process.exit(2);
  }
} catch {
  console.error("Could not read migration status from the isolated Neon database. Verify the test connection and apply project migrations there.");
  process.exit(2);
}
const env = { ...process.env, QUIZZLET_PHASE2_RUN: "1" };
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "src/deck.test.ts", "src/library.test.ts", "server/handlers.test.ts", "server/kid-links.test.ts", "server/library.test.ts", "server/foundation.services.test.ts"], { cwd: root, env, stdio: "inherit" });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
