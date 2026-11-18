# Red-team remediation plan

Source: static red-team review of `main` at `d284521`, 2026-11-18.
Result: 12 findings — 0 critical, 0 high, 5 medium, 7 low.

The parent-account side held up (every query is scoped to the verified account,
secrets are stored hashed, no injection or XSS found). The work below is mostly
about the open, unauthenticated side: scores, guest names, abuse limits, and one
privacy defect around deleted profiles.

## Status

| ID | Issue | Severity | Phase | Status |
|---|---|---|---|---|
| R-05 | A live session keeps working after its profile or account is deleted | Medium | 1 | In progress: implemented, not merged. Cleanup script not yet run. |
| R-01 | Scores are accepted as the browser reports them | Medium | 1 | In progress: implemented, not merged. Residual risk accepted (see the item). |
| R-02 | Guest identity is only a nickname; no filter or removal path | Medium | 1 | In progress: implemented, not merged, on the "guests stay listed" path. **Decision still to confirm.** |
| R-04 | Uploads that are never confirmed don't count against the quota | Medium | 2 | In progress: implemented, not merged. Needs migration `004`. Cleanup script not yet run. |
| R-03 | No rate limits; a permanent Redis entry per guest name | Medium | 2 | In progress: implemented in code, not merged. Cleanup script not yet run. |
| R-07 | Profile, deck and file limits are check-then-insert | Low | 2 | In progress: implemented, not merged (with a row lock; see the notes). |
| R-12 | No security logging | Low | 3 | In progress: implemented, not merged. |
| R-06 | Kid device links never expire on the server | Low | 3 | In progress: implemented, not merged. Needs migration `005`. |
| R-08 | Cookie-setting POSTs accept any origin and content type | Low | 3 | In progress: implemented, not merged. |
| R-09 | A malformed cookie causes a 500 | Low | 3 | In progress: implemented, not merged. |
| R-10 | Dev sign-in and memory stores are gated only on `VERCEL` being unset | Low | 3 | In progress: implemented, not merged. |
| R-11 | No CSP or framing headers | Low | 3 | In progress: implemented, not merged. The content policy is report-only. |

Everything above is on the branch `claude/loving-feynman-k1ittv` as one change set. Update the
Status column as it merges (In progress → Done, with the PR link).

## Implementation notes (2026-11-18)

What was built, where it differs from the plan below, and what is still open. The plan's own
text further down is unchanged.

### Before deploying

1. **Run the migrations first** (`vercel env run -e production -- npm run db:migrate`). The new
   code reads `files.status`, `files.expires_at` (`004_pending_uploads.sql`) and
   `kid_devices.expires_at` (`005_device_expiry.sql`); without them uploads and kid devices
   answer with errors. Existing files become `ready`; existing devices expire 180 days after
   they were linked, so a device linked more than 180 days ago stops working and needs a new link.
2. Deploy.
3. Run the cleanup scripts (below) without `--apply`, read the output, then with `--apply`.

A browser tab still open on the old version keeps working: it already sends a batch id with
every save, and the server reads sessions and receipts written before the change.

### Decisions taken, to confirm

- **R-02: guests stay on the public board.** The welcome screen and the README both tell guests
  their nickname is public, so this is the path that doesn't change the product. Switching to
  "only parent-approved profiles are listed" is still open; it would replace the blocklist work
  with a one-time removal of guest entries.
- **R-03: the limiter is in code,** on the existing Redis store (`RATE_LIMITS` in
  `server/route.ts`). Vercel's `vercel.json` can only express `challenge` and `deny` rules; a
  WAF rate-limit rule has to be made in the dashboard, with `vercel firewall rules add`, the
  REST API or Terraform (Vercel's docs list one such rule on Hobby). A firewall rule in front of `/api/*` is still
  worth adding (it stops a flood before a function runs); the code limiter works without it.
- **R-06: a device link lasts a fixed 180 days** from when it was made, the same as its
  cookie. It is not extended by use. The parent's device list shows the date.
- **R-11: the Clerk hosts in the policy are for a development instance** (`*.clerk.accounts.dev`).
  If production moves to a Clerk production instance, add its Frontend API host
  (`clerk.<your-domain>`) to `script-src` and `connect-src` in `vercel.json`.

### Where the implementation differs from the plan

- **R-01, "ignore the client's `streakBefore`":** the server keeps the streak and never raises
  it from the request, but it lets `streakBefore` *lower* it. The app starts every round's
  streak from zero, and without that signal a streak would carry from one round into the next
  and the server would award more than the app shows. An inflated value earns nothing extra
  (tested); the only thing a client can do with the field is give up a bonus.
- **R-01, pace cap:** 20 answers at once, then one per 1.5 seconds of session age
  (`PACE_BURST`, `PACE_MS_PER_ANSWER` in `server/store.ts`). A refused save is not lost: the
  app keeps the batch and sends the same one again.
- **R-07, "conditional on the count in the same statement":** done, but that alone does not hold
  on PostgreSQL. Two inserts that overlap each count the rows before the other commits. Checked
  against a real PostgreSQL 16 with the single statement only: 26 parallel creates left 22
  profiles (limit 20), 56 left 54 decks (limit 50), and twelve 7 MB uploads were all admitted
  against the 50 MB cap. Each insert now runs in one transaction with
  `select … from accounts … for update` first, so the count is taken after the other request
  has finished. With the lock the same test ends at exactly each limit.
- **R-04:** `status` and `expires_at` on `files` (not a separate table). An upload link is cut
  off at the reservation's end and can carry no more than the declared size. The sweep runs on
  the account's next `start` and removes reservations that ended over an hour ago; expired
  reservations stop counting at once.
- **R-08:** a non-JSON body gets `415`, and a body with no content type is not read. The
  request's "own origin" is taken from `x-forwarded-host`/`x-forwarded-proto` as well as the URL.
- **R-11:** `frame-ancestors 'none'` and `X-Frame-Options: DENY` are **enforced** now, in a
  second header; only the rest of the policy is report-only. Report-only gives no framing
  protection, and nothing legitimate frames the app.
- **R-12:** two events beyond the list: `request.refused` (cross-site or non-JSON) and
  `rate_limit.exceeded`.
- **R-10:** the tests now call the API on `https://localhost`, because the local sign-in
  stand-in refuses any other host.
- **Not in the plan:** an invitation link opened right after the page loaded could be missed
  (the listener was attached a moment later). Two end-to-end tests failed on this before any
  change here; `src/App.tsx` now checks the address once when the listener is attached.
- `scripts/test-redis-score.py` is replaced by `server/store.test.ts`, which runs the real
  `RedisStore` (not a copy of its arguments) against a real Redis; `scripts/test-redis-store.sh`
  runs it in Docker where `redis-server` isn't installed.

### Cleanup scripts

All three only report unless run with `--apply`, and refuse to remove *everything* they find
(the sign of a `DATABASE_URL` from the wrong environment) without `--all-orphans`.

```bash
vercel env run -e production -- node scripts/cleanup-orphan-players.mjs
```

```bash
vercel env run -e production -- node scripts/cleanup-guest-names.mjs
```

```bash
vercel env run -e production -- node scripts/cleanup-orphan-blobs.mjs
```

To take one guest off the board (R-02):

```bash
vercel env run -e production -- node scripts/remove-player.mjs "<nickname>" --apply
```

### Still open

- The four Phase 0 questions (they need the Vercel and Clerk dashboards).
- The R-02 decision.
- Running the migrations and the three cleanup scripts against production.
- Watching the browser console on production for content-policy reports, then moving the
  policy from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. The Clerk
  sign-in and Blob upload paths could not be exercised locally; the policy for them follows
  their documentation and packages, not a test. There is no report endpoint yet, so reports
  only show in the console.
- Not verified here: that `request.url` and the forwarded headers on Vercel give the public
  origin the R-08 check expects (it accepts either). Check one sign-in and one upload on a
  preview deployment before production.
- R-01's residual risk: server-side marking, as a separate item.

## Phase 0: settings to check first (no code)

These decide how urgent some items are. Answer them before starting Phase 2.

- [ ] Is there a Vercel Firewall rate limit or bot rule in front of `/api/*`?
- [ ] Do preview deployments share the production Redis store and Clerk keys? Is Deployment Protection on for previews?
- [ ] Is production on a Clerk production instance (not a development one)? Is sign-up open to any Google account?
- [ ] Are the Vercel system variables (`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`) exposed to functions? If none is set, the authorized-party list in `server/auth.ts` is empty.

## Phase 1: privacy and leaderboard integrity

Suggested timing: within a week.

### R-05 — Re-check the profile on every profile session

- **Problem:** `currentSession` in `server/handlers.ts` re-validates only sessions started from a linked device. A session a parent started for a profile stays valid for up to 60 minutes after the profile or account is deleted, and a score saved in that window recreates the deleted player's entries.
- **Change:**
  - In `currentSession`, for any session with a `profileId`, look the profile up through `accounts.forAccount(session.accountId ?? session.linkedAccountId)` and return `null` if it is gone.
  - Treat a missing `deps.accounts` as "no session" for profile sessions.
- **Cleanup:** a one-off script that removes `p:<id>` members from `leaderboard`, `player-names`, `player-totals` and `leaderboard-hidden` when no `kid_profiles` row has that id.
- **Acceptance tests** (`server/handlers.test.ts`):
  - Start a profile session, delete the profile, save a score → 401; `totalsFor` and the leaderboard are unchanged.
  - Same after `DELETE /api/me`.
  - A hidden profile never appears on the board through this path.
- **Effort:** small.

### R-01 — Stop trusting the client for streaks and pace

- **Problem:** `submitScore` computes points from a client-supplied list of right/wrong answers and a client-supplied `streakBefore`, with no ceiling.
- **Change:**
  - Keep the running streak and an answer count in the session record; ignore the client's `streakBefore`. Update them in the same atomic step that adds points (the Lua script in `RedisStore.addScoreBatch`, and the matching `MemoryStore` code).
  - Add a pace cap: total answers in a session may not exceed what the session's age allows (for example one answer per 1.5 seconds plus a small burst allowance). Over the cap → 429.
  - Require `batchId` and remove the non-idempotent `addPoints` path, once it's confirmed the current client always sends one.
- **Residual risk (accepted for now):** a scripted client can still claim correct answers at human pace. Closing that needs server-side marking (the client sends deck, card and chosen option; the server holds the answer key). Track it as a separate, larger item.
- **Acceptance tests:**
  - A save with an inflated `streakBefore` earns the same points as one without.
  - Saves beyond the pace cap return 429 and add nothing.
  - Replaying a batch still returns the original receipt.
- **Effort:** medium.

### R-02 — Guest names on the public board

- **Problem:** a guest's leaderboard identity is the lowercased nickname. Anyone can play as an existing name, and there is no filter or way to remove a guest entry.
- **Decision needed:** keep guests on the public board, or list only parent-approved profiles?
- **Change (if guests stay listed):**
  - A word blocklist and a single-script rule in `cleanName` for guest names (profile nicknames go through the same check).
  - A `scripts/remove-player.mjs` maintenance script that removes one player key from `leaderboard` and `player-names`.
- **Change (if guests are unlisted):** guests keep session points but are never added to `leaderboard`; remove the existing guest entries once.
- **Acceptance tests:**
  - A blocked or mixed-script name is rejected with 400.
  - The removal script clears the entry and it does not come back on the next leaderboard read.
- **Effort:** small to medium, depending on the decision.

## Phase 2: abuse and cost limits

Suggested timing: within two to three weeks.

### R-04 — Count uploads from the moment they start

- **Problem:** the quota is computed from confirmed file records only. `sign` will issue an upload URL for any well-formed path in the account's folder, so uploads that are never confirmed are stored but not counted.
- **Change:**
  - Migration `004`: add a `status` (`pending` / `ready`) and `expires_at` to `files`, or a separate `pending_uploads` table.
  - `start` inserts a pending row with the declared size; pending rows count toward both the file count and the byte total until they expire (about 15 minutes).
  - `sign` issues a URL only for a path that has a live pending row for this account.
  - `confirm` marks the row ready with the actual size, and deletes the blob if it is larger than declared.
  - A sweep (on the account's next `start`, or a daily cron) deletes blobs for expired pending rows.
- **Cleanup:** a one-off script that lists blobs under `users/` and deletes any without a `files` row.
- **Acceptance tests** (`server/library.test.ts`):
  - `sign` for a path with no pending row → 403.
  - Starting more uploads than the quota allows → 400, even with none confirmed.
  - An expired pending row no longer counts.
- **Effort:** medium.

### R-03 — Rate limits and bounded Redis growth

- **Problem:** nothing limits requests to the open endpoints, and `createSession` writes a permanent `player-names` entry for every guest name.
- **Change:**
  - Rate-limit rules for `POST /api/session`, `POST /api/score`, `GET /api/leaderboard` and `POST /api/kid`, per IP. Prefer Vercel Firewall (check the current docs for configuring it as code); otherwise a small limiter on the existing Redis store.
  - In `createSession`, don't write `player-names` for guests. The score path already writes the name when points are first earned.
- **Cleanup:** remove `player-names` entries that have no `p:` prefix and no `leaderboard` score.
- **Acceptance tests:**
  - Starting a guest session without scoring leaves `player-names` unchanged.
  - If the limiter is in code: the request over the limit returns 429.
- **Effort:** small.

### R-07 — Enforce limits inside the insert

- **Problem:** the profile, deck and file caps are checked with a read and then inserted separately, so parallel requests can overshoot.
- **Change:** make each insert conditional on the current count in the same statement (`insert … select … where (select count(*) …) < max`), and return the "limit reached" error when no row is inserted. Mirror the behaviour in `MemoryAccounts`.
- **Acceptance tests** (`server/accounts.pg.test.ts`): parallel creates at the limit end with exactly the maximum number of rows.
- **Effort:** small.

## Phase 3: hardening

Suggested timing: within a month.

### R-12 — Security event logging

- **Change:** a small `server/log.ts` helper that writes one JSON line per event. Log: failed sign-in checks, account and profile deletion, invite created / redeemed / refused, device unlinked, score saves rejected (409, 429), uploads refused, and unhandled errors.
- **Rule:** log ids and outcomes only — never tokens, cookies, or nicknames.
- **Acceptance:** each event type appears once in a handler test with a captured logger.
- **Effort:** small.

### R-06 — Expire kid device links

- **Change:** migration adding `kid_devices.expires_at` (backfill `created_at + 180 days`); set it on redeem; `findDevice` ignores expired rows; optionally extend it when `last_seen_at` is refreshed.
- **Acceptance:** an expired device gets `{kid: null}` and its cookie is cleared.
- **Effort:** small.

### R-08 — Origin and content-type checks on state-changing requests

- **Change:**
  - `readJson` accepts a body only when `content-type` is `application/json`.
  - For POST, PATCH, PUT and DELETE, when an `Origin` header is present it must match the request's own origin; otherwise 403. (The local upload `PUT` carries raw bytes: origin check only.)
- **Acceptance:** a `text/plain` POST to `/api/kid` or `/api/session` is refused; same-origin requests from the app still pass (covered by the e2e suite).
- **Effort:** small.

### R-09 — Tolerate malformed cookies

- **Change:** catch the decode error in `readCookie` (`server/http.ts`) and return `null`.
- **Acceptance:** a request with a broken cookie value gets the normal 200/401 answer, not a 500.
- **Effort:** tiny.

### R-10 — Tighter gate on dev-only code paths

- **Change:**
  - `getAuthenticator` enables the dev stand-in only when `VERCEL` is unset **and** `NODE_ENV` is not `production` **and** `QUIZZLET_DEV_AUTH=1`.
  - `DevAuthenticator` refuses requests whose host isn't a loopback name.
  - The in-memory stores get the same `NODE_ENV` guard and return `null` (the existing 503 path) otherwise.
- **Acceptance:** unit tests for each combination of the three variables; the e2e suite still runs on the dev server.
- **Effort:** tiny.

### R-11 — Response headers

- **Change:** add a headers config for the deployment: a Content-Security-Policy (start in report-only mode; Clerk and Blob need specific hosts — follow their docs), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Acceptance:** headers present on `/` and `/api/*`; no CSP violations reported during the e2e run before switching to enforcing.
- **Effort:** small to medium.

## Suggested pull requests

1. R-05, R-09, R-10 — small, independent, no schema change.
2. R-01, R-02 — scoring and names (needs the R-02 decision).
3. R-03, R-12 — limits and logging.
4. R-04, R-07, R-06 — the migrations.
5. R-08, R-11 — request and response hardening.

## Done means

- Every acceptance test above is in the unit or e2e suite and passing.
- The three cleanup scripts have been run once against production and their output reviewed.
- The Phase 0 questions are answered and recorded here.
- The Status table shows Done with a PR link for each item, or an explicit "accepted risk" note.
