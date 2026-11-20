// /api/progress: a signed-in parent's view of one kid profile's answers, card
// by card (right or wrong, time taken, answers tried before submitting,
// retries), for the Progress page. Only the profile's own account can read it.

import { MAX_PROGRESS_ATTEMPTS, packProgress, PROGRESS_PERIODS, PROGRESS_RETENTION_DAYS, type ProgressData } from "../src/attempts.js";
import { requireAccount } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { error, json } from "./http.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** GET ?profileId=&days=: the profile's answers in the last `days` days (7, 30, 90 or 180; default 30). */
export async function getProgress(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const params = new URL(request.url).searchParams;
  const profileId = params.get("profileId") ?? "";
  const days = Number(params.get("days") ?? 30);
  if (!PROGRESS_PERIODS.includes(days as (typeof PROGRESS_PERIODS)[number])) {
    return error(400, `days must be one of ${PROGRESS_PERIODS.join(", ")}.`);
  }
  // Another account's profile looks exactly like one that doesn't exist.
  if (!profileId || !(await ctx.scope.getProfile(profileId))) return error(404, "Profile not found.");

  const since = new Date(deps.now() - Math.min(days, PROGRESS_RETENTION_DAYS) * DAY_MS).toISOString();
  const rows = await ctx.scope.listAttempts(profileId, since, MAX_PROGRESS_ATTEMPTS + 1);
  const truncated = rows.length > MAX_PROGRESS_ATTEMPTS;
  const body: ProgressData = { profileId, days, since, truncated, ...packProgress(rows.slice(0, MAX_PROGRESS_ATTEMPTS)) };
  return json(body);
}
