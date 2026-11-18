// One-off cleanup (remediation R-04): deletes stored files that no file record
// points to. An upload that was never confirmed used to stay in Blob storage
// without counting against the account's quota; uploads now have a record from
// the moment they start.
//
// Lists every blob under users/ and deletes those with no row in `files`.
// Blobs newer than an hour are left alone (an upload may be in progress).
//
// Usage: vercel env run -e production -- node scripts/cleanup-orphan-blobs.mjs [--apply]
import { neon } from "@neondatabase/serverless";
import { del, list } from "@vercel/blob";
import { applyNote, chunks, databaseUrl, fail, isMain } from "./lib/maintenance.mjs";

const HOUR_MS = 60 * 60 * 1000;

/**
 * `listPage(cursor)` returns {blobs: [{pathname, size, uploadedAt}], cursor?};
 * `knownPaths(paths)` returns which of them have a file record;
 * `remove(paths)` deletes blobs.
 */
export async function cleanupOrphanBlobs({ listPage, knownPaths, remove }, { apply = false, allowAll = false, now = Date.now(), minAgeMs = HOUR_MS } = {}) {
  const orphans = [];
  let total = 0;
  let cursor;
  do {
    const page = await listPage(cursor);
    total += page.blobs.length;
    const known = new Set(page.blobs.length ? await knownPaths(page.blobs.map((blob) => blob.pathname)) : []);
    for (const blob of page.blobs) {
      const settled = now - new Date(blob.uploadedAt).getTime() >= minAgeMs;
      if (!known.has(blob.pathname) && settled) orphans.push({ pathname: blob.pathname, size: blob.size });
    }
    cursor = page.cursor;
  } while (cursor);

  // Every file looking unrecorded is far more likely the wrong database than the truth.
  const suspicious = total > 0 && orphans.length === total;
  const removed = apply && orphans.length > 0 && (!suspicious || allowAll);
  if (removed) {
    for (const batch of chunks(orphans.map((blob) => blob.pathname), 100)) await remove(batch);
  }
  return { blobs: total, orphans, bytes: orphans.reduce((sum, blob) => sum + blob.size, 0), suspicious, removed };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) fail("Blob storage isn't configured: set BLOB_READ_WRITE_TOKEN.");
  const sql = neon(databaseUrl());
  const result = await cleanupOrphanBlobs(
    {
      listPage: async (cursor) => {
        const page = await list({ prefix: "users/", cursor, limit: 1000 });
        return { blobs: page.blobs, cursor: page.hasMore ? page.cursor : undefined };
      },
      knownPaths: async (paths) => (await sql.query("select pathname from files where pathname = any($1)", [paths])).map((row) => String(row.pathname)),
      remove: (paths) => del(paths),
    },
    { apply, allowAll: args.includes("--all-orphans") },
  );

  console.log(`${result.blobs} stored file(s) under users/; ${result.orphans.length} with no file record (${(result.bytes / (1024 * 1024)).toFixed(1)} MB).`);
  for (const blob of result.orphans) console.log(`  ${blob.pathname} (${blob.size} bytes)`);
  if (result.suspicious && !result.removed) {
    fail("Every one of them looks unrecorded. Check DATABASE_URL points at the same environment as the Blob store; if this really is right, add --all-orphans.");
  }
  console.log(result.removed ? "Deleted." : result.orphans.length ? applyNote(apply).trim() : "Nothing to clean up.");
}
