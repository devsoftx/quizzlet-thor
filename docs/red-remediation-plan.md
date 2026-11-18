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
| R-05 | A live session keeps working after its profile or account is deleted | Medium | 1 | Done: [#15] (blue-team R1). The one-off cleanup script came with [#14]; **still to be run once** on production. |
| R-01 | Scores are accepted as the browser reports them | Medium | 1 | Done: [#15] (blue-team R6). Residual risk accepted (blue-team R11, not started). |
| R-02 | Guest identity is only a nickname; no filter or removal path | Medium | 1 | Done: [#15] (blue-team R12, R14), [#14] (one-alphabet rule, built-in word list), [#18] (Spanish and more English words). Guests stay listed. |
| R-04 | Uploads that are never confirmed don't count against the quota | Medium | 2 | Done: [#15] (blue-team R7). |
| R-03 | No rate limits; a permanent Redis entry per guest name | Medium | 2 | Names: done, [#15] (blue-team R8). Rate limits: **open**, Vercel Firewall rules (blue-team R3). |
| R-07 | Profile, deck and file limits are check-then-insert | Low | 2 | Done: [#15] (blue-team R9). |
| R-12 | No security logging | Low | 3 | Done: [#15] (blue-team R2). Log drain still to set up. |
| R-06 | Kid device links never expire on the server | Low | 3 | Done: [#14]. Migration `006` is applied by the production deploy that ships it ([#16]). |
| R-08 | Cookie-setting POSTs accept any origin and content type | Low | 3 | Done: [#15] (blue-team R5). |
| R-09 | A malformed cookie causes a 500 | Low | 3 | Done: [#15] (blue-team R4). |
| R-10 | Dev sign-in and memory stores are gated only on `VERCEL` being unset | Low | 3 | Done: [#14]. |
| R-11 | No CSP or framing headers | Low | 3 | Done: [#15] (blue-team R5), with the checks on the wire in [#14]. The content policy is still report-only. |

All the code for this plan is merged. What is left is outside the code: one cleanup run, the rate-limit
rules, and the settings questions in Phase 0 (see [Still open](#still-open)).

[#14]: https://github.com/devsoftx/quizzlet-thor/pull/14
[#15]: https://github.com/devsoftx/quizzlet-thor/pull/15
[#16]: https://github.com/devsoftx/quizzlet-thor/pull/16
[#18]: https://github.com/devsoftx/quizzlet-thor/pull/18

## How this plan was carried out (18 November 2026)

Two reviews of the same code produced two plans: this one and
[`docs/security/blue-remediation-plan.md`](security/blue-remediation-plan.md). The blue-team plan was
implemented and merged first ([#15]), and it covers most of the items here, sometimes by a different route.
Where the two overlap, that implementation stands and nothing here replaced it. Pull request [#14] then
added only what this plan asks for that `main` did not have yet. For the items done in [#15], the
blue-team plan's "Implementation status" section is the record of what was built and checked.

### What #14 added

- **R-06.** Migration `006_device_expiry.sql` gives `kid_devices` an `expires_at`. A link lasts a fixed
  180 days from when it was made, the same as its cookie; it is not extended by use. After that the device
  is not found, is not listed, does not count against the 10-device limit, and its cookie is cleared. The
  parent's device list shows the date. Existing devices get 180 days from when they were linked, so **a
  device linked more than 180 days ago stops working when the migration runs** and needs a new link.
- **R-10.** The local sign-in stand-in needs all of: not on Vercel, `NODE_ENV` not `production`, and
  `QUIZZLET_DEV_AUTH=1`; and it only answers requests addressed to `localhost`. The in-memory stores have
  the same Vercel and `NODE_ENV` guard. The tests now call the API on `https://localhost` for that reason.
- **R-02.** `server/names.ts`: a nickname's letters must come from one alphabet (Japanese and Korean
  writing may mix their own scripts), styled letters are folded to plain ones, and a built-in word list
  is always on ([#18] later added Spanish and more English words to it). It applies to guests, kid
  profiles and the parent's name, and needs no Global Config. The operator's `blockedNames` list
  (blue-team R14) is checked after it, for guests, as before.
- **R-05, cleanup.** `scripts/cleanup-orphan-players.mjs` removes leaderboard data left by profiles that
  were deleted before sessions were re-checked. It only reports unless given `--yes`, and removes nothing
  if every profile looks deleted (the sign of a `DATABASE_URL` from another environment).
- **R-11, acceptance.** The dev and preview servers now send the headers from `vercel.json`, and every
  end-to-end test fails if the browser reports a content-policy violation. A new `e2e/security.e2e.ts`
  checks the headers on `/` and `/api/*`, that another site cannot frame the app, and that a violation
  reaches `/api/csp-report`.
- **Not in either plan.** An invitation link opened right after the page loaded could be missed, because
  the listener was attached a moment later. This is what made two `kid-device.e2e.ts` tests fail (the
  blue-team notes put it down to the browser build). `src/App.tsx` now checks the address when the
  listener is attached, and both tests pass.

### Where `main` took a different route than this plan

- **R-03:** no limiter in code. Rate limits are left to Vercel Firewall rules, which this plan also
  preferred; they are not created yet, so the open routes have no request limit until they are. The pace
  limit on score saves (R-01) is in place.
- **R-04:** a `file_reservations` table instead of a status on `files`. The cleanup never lists the Blob
  store, so the "delete blobs without a row" script this plan describes was deliberately not written;
  uploads abandoned before the change are handled by hand (see the runbook).
- **R-07:** triggers that lock the account row, instead of a conditional insert. A conditional insert on
  its own does not hold on PostgreSQL when two requests overlap.
- **R-02:** guests stay on the public board (this plan's open decision), and a guest nickname now belongs
  to the browser that first used it (blue-team R12).
- **R-01:** the browser's `streakBefore` may lower the stored streak, never raise it, so a new round
  starts from zero as the app shows it.

### Now that it is merged

1. **Migrations run with the deploy.** Since [#16], a production deploy applies new migrations in its
   build, so `006_device_expiry.sql` goes in with the deploy that ships the code that reads it. Nothing
   to run by hand (the runbook says which database role that step needs). Kid devices linked more than
   180 days ago stop working at that point.
2. **Run the cleanup once**, after that deploy, first without `--yes`:

   ```bash
   vercel env run -e production -- node scripts/cleanup-orphan-players.mjs
   ```

### Still open

- The one cleanup run above.
- R-03's rate limits (Firewall rules). Until they exist the open routes have no request limit.
- The four Phase 0 questions below, and the R-02 decision if listing only parent-approved profiles is
  still wanted.
- Everything under "Left for you" in the blue-team plan.

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
