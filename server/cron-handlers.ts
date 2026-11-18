// /api/cron: the daily cleanup, called by Vercel Cron (see vercel.json).
//
//  1. Guest leaderboard data: keep the top guest entries, drop the rest.
//  2. Stored files: delete uploads that were never confirmed.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET` with scheduled calls. The
// route refuses everything else, and refuses to run at all without a secret.

import { timingSafeEqual } from "node:crypto";
import { defaultDeps, type Deps } from "./deps.js";
import { error, json } from "./http.js";
import { errorName, securityEvent } from "./log.js";

/** Guest leaderboard entries kept; kid profiles are never removed. */
export const GUESTS_KEPT = 1000;
/** An upload with no file record and no live reservation is deleted once it's this old. */
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

const UPLOADS_ROOT = "users/";
const iso = (ms: number) => new Date(ms).toISOString();

function sameSecret(given: string | null, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function pruneGuests(deps: Deps) {
  if (!deps.store) return { skipped: true };
  const { removed } = await deps.store.pruneGuests(GUESTS_KEPT);
  securityEvent("leaderboard.pruned", { removed, kept: GUESTS_KEPT });
  return { removed };
}

async function removeOrphanUploads(deps: Deps) {
  const { files, accounts } = deps;
  if (!files || !accounts) return { skipped: true };
  const now = deps.now();
  const reservationsSwept = await accounts.sweepReservations(iso(now));

  // Everything old enough to judge, and which of it the database knows about.
  const old: string[] = [];
  const known = new Set<string>();
  let scanned = 0;
  let cursor: string | undefined;
  do {
    const page = await files.list(UPLOADS_ROOT, cursor);
    scanned += page.blobs.length;
    const candidates = page.blobs.filter((b) => now - b.uploadedAt > ORPHAN_AGE_MS).map((b) => b.pathname);
    for (const pathname of await accounts.knownUploads(candidates, iso(now))) known.add(pathname);
    old.push(...candidates);
    cursor = page.cursor;
  } while (cursor);

  const orphans = old.filter((pathname) => !known.has(pathname));
  // If the database recognises none of the stored files, it is far more likely
  // the wrong (or an empty) database than a store full of orphans: delete nothing.
  if (old.length >= 10 && known.size === 0) {
    securityEvent("file.orphan.aborted", { scanned, candidates: old.length, reason: "no-known-files" });
    return { scanned, deleted: 0, aborted: true };
  }
  for (let i = 0; i < orphans.length; i += 500) await files.delete(orphans.slice(i, i + 500));
  securityEvent("file.orphan.deleted", { scanned, deleted: orphans.length, reservationsSwept });
  return { scanned, deleted: orphans.length, reservationsSwept };
}

/** GET (with the cron secret): run the cleanup. A failing task is logged and doesn't stop the other. */
export async function runCleanup(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.cronSecret) return error(503, "The scheduled cleanup isn't set up yet (CRON_SECRET).");
  if (!sameSecret(request.headers.get("authorization"), `Bearer ${deps.cronSecret}`)) {
    securityEvent("cron.denied", {});
    return error(401, "Not allowed.");
  }

  const tasks = { guests: pruneGuests, uploads: removeOrphanUploads };
  const results: Record<string, unknown> = {};
  let failed = false;
  for (const [name, task] of Object.entries(tasks)) {
    try {
      results[name] = await task(deps);
    } catch (err) {
      failed = true;
      results[name] = { failed: true };
      securityEvent("cron.error", { task: name, errorName: errorName(err) });
    }
  }
  return json({ ok: !failed, ...results }, failed ? 500 : 200);
}
