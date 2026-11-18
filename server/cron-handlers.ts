// /api/cron: the daily cleanup, called by Vercel Cron (see vercel.json).
//
//  1. Guest leaderboard data: keep the top guest entries, drop the rest.
//  2. Stored files: delete uploads that were started and never saved.
//
// Vercel sends `Authorization: Bearer $CRON_SECRET` with scheduled calls. The
// route refuses everything else, and refuses to run at all without a secret.

import { timingSafeEqual } from "node:crypto";
import { defaultDeps, type Deps } from "./deps.js";
import { error, json } from "./http.js";
import { errorName, securityEvent } from "./log.js";

/** Guest leaderboard entries kept; kid profiles are never removed. */
export const GUESTS_KEPT = 1000;
/**
 * An upload that was never saved is deleted, and its reservation record
 * dropped, this long after the reservation ran out. (The account's own next
 * upload clears it sooner; see ?action=start in library-handlers.ts.)
 */
export const ABANDONED_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

const PAGE = 500;
const MAX_PAGES = 40;
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

/**
 * Deletes what was uploaded for reservations that ran out a day ago, then
 * drops those records. It only ever touches a path the database has on record
 * as "started, never saved": nothing is deleted because a record is *missing*,
 * so pointing the job at the wrong or an empty database deletes nothing.
 */
async function removeAbandonedUploads(deps: Deps) {
  const { files, accounts } = deps;
  if (!files || !accounts) return { skipped: true };
  const before = iso(deps.now() - ABANDONED_UPLOAD_AGE_MS);
  let deleted = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const pathnames = await accounts.expiredReservations(before, PAGE);
    if (pathnames.length === 0) break;
    await files.delete(pathnames); // deleting a path that holds nothing is fine
    deleted += await accounts.forgetReservations(pathnames, before);
    if (pathnames.length < PAGE) break;
  }
  securityEvent("file.orphan.deleted", { deleted });
  return { deleted };
}

/** GET (with the cron secret): run the cleanup. A failing task is logged and doesn't stop the other. */
export async function runCleanup(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!deps.cronSecret) return error(503, "The scheduled cleanup isn't set up yet (CRON_SECRET).");
  if (!sameSecret(request.headers.get("authorization"), `Bearer ${deps.cronSecret}`)) {
    securityEvent("cron.denied", {});
    return error(401, "Not allowed.");
  }

  const tasks = { guests: pruneGuests, uploads: removeAbandonedUploads };
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
