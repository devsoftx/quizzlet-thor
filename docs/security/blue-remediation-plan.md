# Security remediation plan

This plan comes from a blue-team review of the code at `d284521` (18 November 2026). The review covered
`api/`, `server/`, `db/migrations/`, the dev API middleware in `vite.config.ts`, and the browser's sign-in and
API client. It found 16 issues (F1–F16). This document turns them into work items (R1–R16), each with what to
change, where, and how to know it's done.

Line numbers refer to `d284521`.

## What already works

These controls are in place. Keep them as the work below goes in:

- Every SQL statement is a tagged template with bound parameters, and every account query filters by the
  verified Clerk user id (`server/accounts.ts:427-599`).
- Deck assignments, invites and devices carry `account_id` in composite foreign keys, so a row can't point at
  another account's profile (`db/migrations/002_decks_files.sql:23-31`, `003_kid_links.sql:12,25`).
- Invitation tokens and device cookies are 256-bit random values, and only their SHA-256 hashes are stored
  (`server/kid-handlers.ts:29-31`). An invite is used up in a single statement (`server/accounts.ts:395-409`).
- The invite token travels in the URL fragment (`#join=…`), which never reaches the server or a `Referer`
  header, and the app removes it from the address bar (`src/api.ts:135-144`).
- Session and device cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS (`server/http.ts:46-51`).
- Linked-device sessions are checked again on every request (`server/handlers.ts:46-50`).
- Upload URLs are signed for one exact path, one content type and a size limit, with overwrite off
  (`server/files.ts:122-140`). Read links last five minutes (`server/files.ts:159-164`).
- The local sign-in stand-in can't turn on when running on Vercel, and its ids are prefixed `dev_`, so it can't
  pose as a real Clerk user (`server/auth.ts:67-93`).
- No `dangerouslySetInnerHTML` or similar raw-HTML sinks in `src/`.

## Phases at a glance

| Phase | Goal | Items | Rough effort |
|---|---|---|---|
| 0: this week | Fix the privacy bug, add visibility, basic abuse limits | R1–R5 | 3–5 days |
| 1: next two weeks | Bound score and storage abuse | R6–R10 | 1–2 weeks |
| 2: next quarter | Server-checked scoring, least privilege, operational controls | R11–R16 | 3–5 weeks |

## Tracker

| Item | Fixes | Title | Severity | Effort | Phase | Status |
|---|---|---|---|---|---|---|
| R1 | F2 | Stop deleted profiles reappearing on the public leaderboard | Medium | S | 0 | Not started |
| R2 | F3, F7 | Structured security logging and a log drain | High | S–M | 0 | Not started |
| R3 | F4 | Rate limits with Vercel Firewall | Medium | S | 0 | Not started |
| R4 | F9 | Safe cookie parsing | Low | S | 0 | Not started |
| R5 | F8, F13, F14 | Security headers, Origin check, Clerk production instance | Low | S | 0 | Not started |
| R6 | F1 (partly) | Server-side streak and per-session score limits | Medium | M | 1 | Not started |
| R7 | F5 | Upload reservations that count against the quota | Medium | M | 1 | Not started |
| R8 | F6 | Prune guest leaderboard data | Low | S | 1 | Not started |
| R9 | F10 | Enforce profile, deck and file limits in the database | Low | S | 1 | Not started |
| R10 | F11 | Patch the vulnerable transitive `zod` | Low | S | 1 | Not started |
| R11 | F1 | Server-checked answers | Medium | L | 2 | Not started |
| R12 | F12 | Guest names owned by a browser | Low | M | 2 | Not started |
| R13 | F15 | Least-privilege database role and secret scoping | Low | M | 2 | Not started |
| R14 | F16 | Leaderboard kill switch and moderation | Low | S–M | 2 | Not started |
| R15 | — | Detection rules on top of R2 | — | S | 2 | Not started |
| R16 | — | Incident runbook: rotation and revocation | — | S | 2 | Not started |

---

## Phase 0: this week

### R1. Stop deleted profiles reappearing on the public leaderboard (F2)

**Problem.** A session that a signed-in parent starts for a kid profile isn't checked again after that profile
is deleted. Only linked-device sessions are (`server/handlers.ts:46`). Deleting the profile calls
`removePlayer`, which also takes the profile out of `leaderboard-hidden` (`server/store.ts:190-197`). The next
score save then recreates `player-totals` and adds the kid's nickname to the public board, because the profile
no longer looks hidden (`server/store.ts:282-288`).

This happened in an in-memory reproduction: a private profile named "Secret Kid" was deleted mid-session, the
next save returned 200, and the board then showed `[{"rank":1,"name":"Secret Kid","points":10}]`. Account
deletion goes through the same path (`server/account-handlers.ts:113-116`). The existing test only covers
linked devices (`server/kid-links.test.ts:312-321`).

**Change.**

1. In `currentSession` (`server/handlers.ts:42-51`), check that the profile still exists for *every* session
   with a `profileId`, not only linked-device ones:

   ```ts
   const session = await deps.store.getSession(id, deps.now());
   if (!session?.profileId) return session;                 // guests
   if (session.linkedDeviceId) { /* existing device checks */ }
   const accountId = session.accountId ?? session.linkedAccountId;
   if (!accountId || !deps.accounts) return null;
   if (!(await deps.accounts.forAccount(accountId).getProfile(session.profileId))) return null;
   return session;
   ```

   Profile sessions from before `accountId` was stored (at most 60 minutes old at deploy time) will be refused.
   That fails closed, which is acceptable.
2. Rename `linkedSessionWasRevoked` to `profileSessionWasRevoked`. Have it return true for any stored session
   that has a `profileId`, so the client gets the existing 403 "ended" path and the cookie is cleared.
3. Make `removePlayer` leave a marker: in both `RedisStore` and `MemoryStore`, **add** the key to
   `leaderboard-hidden` instead of removing it. Then even a late write can't make a deleted profile public. The
   set grows by one entry per deleted profile, which is negligible. Don't make the score script refuse hidden
   keys with no total: a new private profile looks exactly like that until its first save.

**Tests.**

- `server/kid-links.test.ts`: a parent-started session for a private profile, then the profile is deleted, then
  a score save returns 403, the leaderboard doesn't list the nickname, and `totalsFor` returns 0.
- The same test with `deleteMe` instead of `deleteProfile`.
- `scripts/test-redis-score.py`: after `removePlayer`, a score for that key isn't added to `leaderboard`.
- The live-services test cleans up with `removePlayer` (`server/foundation.services.test.ts:151`). Once the marker
  stays behind, also remove the test keys from `leaderboard-hidden` there, so the dedicated test Redis doesn't
  fill up.

**Done when** none of those paths can put a deleted or private profile's nickname on `/api/leaderboard`, and the
README's promise at line 160 holds.

### R2. Structured security logging and a log drain (F3, F7)

**Problem.** `server/` has no log statements. Failed sign-ins, account deletion, invite use, device links, uploads
and score saves leave no trace beyond the platform's request logs. When Clerk throws, the error is swallowed and
looks like a normal sign-out (`server/account-handlers.ts:31-35`).

**Change.**

1. Add `server/log.ts`:

   ```ts
   export function securityEvent(event: string, fields: Record<string, string | number | boolean | null>) {
     console.info(JSON.stringify({ ts: new Date().toISOString(), kind: "security", event, ...fields }));
   }
   export const sessionHash = (id: string) => createHash("sha256").update(`log:${id}`).digest("hex").slice(0, 16);
   ```

2. Log these events. **Never** log tokens, cookies, invite secrets, file contents, display names or kid
   nicknames; use ids.

   | Event | Where | Fields |
   |---|---|---|
   | `auth.error` | `requireAccount` catch | `errorName`, `route` |
   | `auth.denied` | `requireAccount` → 401 | `route` |
   | `account.created` / `account.deleted` | `ensureAccount`, `deleteMe` | `accountId`, `deletedProfiles` |
   | `profile.created` / `profile.deleted` / `profile.visibility` | `server/account-handlers.ts` | `accountId`, `profileId`, `listed` |
   | `invite.created` / `invite.cancelled` | `server/kid-handlers.ts:99-129` | `accountId`, `profileId` |
   | `invite.miss` | `postKid` → 404 | `action` (`peek`/`join`) |
   | `device.linked` / `device.unlinked` | `postKid`, `deleteLink`, `deleteKid` | `accountId`, `profileId`, `deviceId`, `by` |
   | `session.started` / `session.revoked` | `startSession`, R1 path | `kind` (guest/profile/kid), `sessionHash`, `profileId` |
   | `score.saved` / `score.conflict` / `score.replay` | `submitScore` | `sessionHash`, `profileId`, `answers`, `points`, `batch` |
   | `file.sign` / `file.sign.refused` / `file.confirmed` / `file.rejected` / `file.deleted` | `server/library-handlers.ts:197-291` | `accountId`, `fileId`, `bytes`, `reason` |
   | `deck.created` / `deck.deleted` | `server/library-handlers.ts:56-121` | `accountId`, `deckId` |

3. Wrap each `api/*.ts` export in a `withErrors(route, handler)` that logs `request.error` (route, method, error
   name, a request id) and returns a generic `500 {"error": "Something went wrong."}`, so failures are counted
   instead of disappearing.
4. Set up a Vercel **log drain** to the team's log tool and record the retention period here. Vercel's built-in
   runtime logs are kept only briefly.

**Tests.** Spy on `console.info` in the handler tests. Check that each event fires once and that no logged string
contains the invite token, the device cookie or the nickname used in the test.

**Done when** each event in the table shows up in the drain from a preview deployment, and R15's rules can run
on it.

### R3. Rate limits with Vercel Firewall (F4)

**Problem.** No endpoint is rate-limited, so a guest can start unlimited sessions and saves, and a signed-in
parent can request unlimited upload URLs.

**Change.** Add Vercel Firewall rate-limit rules (set up in the dashboard or API, then recorded in this file).
Run them in **log-only mode for a week**, compare against real traffic, then switch to deny (429).

**A whole classroom often shares one IP address**, so per-IP limits must allow for about 30 kids at once.

| Route | Method | Starting limit (per IP) | Why |
|---|---|---|---|
| `/api/session` | POST | 60 / 10 min | Session and guest-name flooding (also caps F1 and F6) |
| `/api/score` | POST | 600 / 1 min | The client saves in small batches (`src/scoreSaver.ts:108-111`); 30 kids × several saves a minute |
| `/api/kid` | POST | 60 / 10 min | Invite probing (tokens can't be guessed, but this cuts noise and cost) |
| `/api/files` | POST | 60 / 10 min | Upload signing (F5) |
| `/api/me`, `/api/profiles`, `/api/decks`, `/api/invites` | all | 600 / 5 min | General abuse ceiling |

**Done when** the rules are on, a scripted burst against a preview deployment gets 429s, and normal classroom use
causes none in a week of log-only mode.

### R4. Safe cookie parsing (F9)

**Problem.** `decodeURIComponent` in `readCookie` (`server/http.ts:37`) throws on a malformed value such as
`qz_session=%E0%A4%A`, and the request then fails with a 500.

**Change.** Wrap the decode in `try`/`catch` and return `null` on failure.

**Done when** a unit test with a malformed cookie gets the normal "no session" answer from `GET /api/session`.

### R5. Security headers, Origin check, Clerk production instance (F8, F13, F14)

**Problem.** There are no CSP, `frame-ancestors`, Referrer-Policy or Permissions-Policy headers, and no Vercel
config file at all. Cookie-based POSTs don't check `Origin`, and `readJson` accepts any content type
(`server/http.ts:14-21`). That means a cross-site `text/plain` form could replace a guest session or link a
victim's device to someone else's kid profile (`server/kid-handlers.ts:151-183`). The README also suggests a
Clerk *development* instance (`README.md:164-167`).

**Change.**

1. Add `vercel.json` (or `vercel.ts` with `@vercel/config`) with headers for every route. Start with
   `Content-Security-Policy-Report-Only`, check the reports, then enforce:

   ```text
   Content-Security-Policy: default-src 'self';
     script-src 'self' https://<clerk-frontend-api> https://challenges.cloudflare.com;
     connect-src 'self' https://<clerk-frontend-api> https://<blob-upload-host>;
     img-src 'self' data: https://img.clerk.com; style-src 'self' 'unsafe-inline';
     frame-src https://challenges.cloudflare.com; worker-src 'self' blob:;
     frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
   X-Content-Type-Options: nosniff
   Referrer-Policy: strict-origin-when-cross-origin
   Permissions-Policy: camera=(), microphone=(), geolocation=()
   ```

   Take the exact Clerk hosts from the production instance. The browser uploads straight to Blob, so read the
   upload host from the report-only violations before enforcing. `'unsafe-inline'` for styles is there because
   Clerk injects styles.
2. In `server/http.ts`, add `requireSameOrigin(request)` and call it first in every POST, PATCH, PUT and DELETE
   handler. Reject with 403 when `Origin` is present and isn't one of the allowed origins (reuse
   `authorizedParties` from `server/auth.ts:20-30`). Make `readJson` require
   `content-type: application/json`. The client already sends it (`src/api.ts:70`), and saves sent with
   `keepalive` still carry `Origin`.
3. Confirm production uses a **Clerk production instance** on the production domain. If it doesn't, create one,
   move the keys over in Vercel, and change the README.

**Done when** `securityheaders.com` (or `curl -I`) shows the headers on production, a cross-site form POST to
`/api/kid` and `/api/session` gets 403, the e2e suite passes with the CSP enforced, and the Clerk instance type is
recorded under "Open questions" below.

---

## Phase 1: next two weeks

### R6. Server-side streak and per-session score limits (F1, partly)

**Problem.** Points come from `answers[]` and `streakBefore` exactly as the client sends them
(`server/handlers.ts:176-199`). In the reproduction, 20 requests with 200 `true` answers each and
`streakBefore: 200` gave 60,000 points.

**Change.** This narrows the abuse; R11 removes it.

1. Keep `streak` and `answered` in the session hash. In the score Lua script, ignore any client `streakBefore`
   (or reject it if it differs from the stored streak), compute points from the stored streak, and update both
   fields atomically.
2. Cap how fast answers can arrive: refuse a batch when `answered + answers.length` is more than
   `20 + (now − sessionStart) / 2000` (one answer per 2 seconds plus a burst of 20). Return 429 and log
   `score.limited`.
3. Require `sessionTag` on every batch. Older clients that omit it are already out of date.

**Done when** the reproduction is held to that rate (at most 1,820 answers, about 27,000 points, per hour-long
session), the
normal study flow and the "streak bonus" e2e test in `e2e/quiz.e2e.ts` still pass, and a test sending a forged
`streakBefore` gets no bonus.

### R7. Upload reservations that count against the quota (F5)

**Problem.** `?action=sign` accepts any well-formed path inside the user's folder and only counts confirmed files
(`server/library-handlers.ts:219-227`, `server/files.ts:72-78`). A parent can sign and upload any number of 15 MB
files and never confirm them. Those files don't count against the quota and stay until the account is deleted.

**Change.**

1. Migration `004_file_reservations.sql`:

   ```sql
   create table if not exists file_reservations (
     pathname text primary key,
     account_id text not null references accounts (id) on delete cascade,
     declared_bytes bigint not null check (declared_bytes > 0),
     expires_at timestamptz not null
   );
   create index if not exists file_reservations_account_idx on file_reservations (account_id);
   ```

2. `start` creates a reservation that expires in 15 minutes. The quota then counts confirmed files **plus
   unexpired reservations**, by both count and bytes.
3. `sign` only accepts a path that has an unexpired reservation for this account, and signs it with
   `maximumSizeInBytes = declared_bytes`, not the 15 MB maximum.
4. `confirm` deletes the reservation once the file is recorded.
5. Daily Vercel Cron cleanup: list blobs under `users/`, and delete any that has neither a `files` row nor an
   active reservation and is more than 24 hours old. Log `file.orphan.deleted` with counts.

**Done when** signing a path without a reservation gets 403, the 21st reservation or one over 50 MB is refused,
the cleanup removes an unconfirmed upload in a test store, and the existing tests in `server/library.test.ts`
and `e2e/decks-and-files.e2e.ts` pass.

### R8. Prune guest leaderboard data (F6)

**Problem.** Every guest name is written to `player-names` and `leaderboard` and never removed
(`server/store.ts:174,251-252,288`), so Redis keeps growing.

**Change.** Add a daily cron that keeps the top 1,000 guest entries and removes the rest (members without a `p:`
prefix) from `leaderboard` and `player-names`. Never touch `p:` keys. Also set an Upstash memory or usage alert.

**Done when** a test fills the store with 2,000 guest names and the cron leaves 1,000 plus every kid profile.

### R9. Enforce profile, deck and file limits in the database (F10)

**Problem.** The limit of 20 profiles, 50 decks and 20 files is checked by reading the count and then inserting
(`server/account-handlers.ts:165-168`, `server/library-handlers.ts:67,241-259`), so concurrent requests can go
over it.

**Change.** Add `BEFORE INSERT` triggers on `kid_profiles`, `decks` and `files`. Each trigger first locks the
account row (`perform 1 from accounts where id = new.account_id for update`), then counts and raises an error at
the limit. Under READ COMMITTED, each statement in a trigger sees rows committed while it waited for the lock, so
the count is accurate. Map that error to the existing 400 messages.

**Done when** 10 concurrent `createProfile` calls on an account with 19 profiles leave exactly 20, tested with
`server/accounts.pg.test.ts` against the disposable Postgres in `scripts/test-foundation-postgres.sh`.

### R10. Patch the vulnerable transitive `zod` (F11)

**Problem.** `npm audit` reports GHSA-mrhx-c7xc-m3w5 (high severity) through `@vercel/blob@2.8.2` →
`@vercel/oidc@3.8.10` → `@vercel/cli-config@0.3.1`, which pins `zod@4.1.11`. User input probably can't reach it.

**Change.** Add an npm override and check everything still works:

```json
"overrides": { "@vercel/cli-config": { "zod": "4.6.6" } }
```

**Done when** `npm audit --omit=dev` reports no high-severity issues and `npm test` and `npm run test:e2e` pass.
Remove the override once `@vercel/blob` ships a fixed version.

---

## Phase 2: next quarter

### R11. Server-checked answers (F1)

**Problem.** The server can't tell a real answer from a made-up `true`.

**Change.**

1. `POST /api/round {deckId}` returns a `roundId` and the card order. The server loads the deck: shared decks
   from `decks/` (bundled into the function), private decks from the database.
2. Each answer is `{roundId, cardIndex, option}`. The server checks it against the deck's answer, allows one
   answer per card per round, works out the streak itself, and stores points in one atomic step as in R6.
3. Decks imported only into the browser (local storage) earn no leaderboard points unless they're uploaded. That
   is a product decision; see the open questions.

Shared deck answers are public, so someone who knows the answers can still score. But points now need a real
card, once per round, at a human pace. The forged-points reproduction should earn nothing.

**Done when** points can only come from real cards in a round, and the quiz, retry and results e2e tests pass.

### R12. Guest names owned by a browser (F12)

**Problem.** A guest's leaderboard identity is just the lowercased name (`server/handlers.ts:26,124-128`), so
anyone who types the same name adds to or takes over that row.

**Change.** Give each browser a long-lived `qz_guest` cookie (HttpOnly, 30 days, random) and keep
`guest-owner:<playerKey>` → a hash of that cookie. Starting a session with a name owned by another browser gets
409 "That nickname is taken". Show kid-profile rows with their emoji, so a guest can't pass as a kid with the same
nickname.

**Done when** two browsers can't share a guest row, and the e2e tests in `e2e/guest.e2e.ts` pass.

### R13. Least-privilege database role and secret scoping (F15)

**Problem.** Migrations and the running app probably share one `DATABASE_URL` with the owner role
(`scripts/migrate.mjs:8-13`, `server/accounts.ts:607-608`), and every function gets every secret.

**Change.**

1. Create a Neon role `quizzlet_app` with `select, insert, update, delete` on the app's tables and no DDL. Use it
   for the runtime `DATABASE_URL`. Keep the owner connection in `DATABASE_URL_MIGRATIONS` and use it only for
   `npm run db:migrate`.
2. Give preview deployments their own Upstash, Blob and Neon branch, or none, so a preview can never write to
   production data.
3. Prefer OIDC to `BLOB_READ_WRITE_TOKEN` where the Blob store supports it.
4. List who can read the Vercel project's environment variables, and remove anyone who doesn't need to.

**Done when** the runtime role can't run `drop table`, and the preview environment's variables point at non-production
resources.

### R14. Leaderboard kill switch and moderation (F16)

**Problem.** There's no way to remove a bad name or a forged score, or to hide the leaderboard, without changing
env vars and redeploying, and that turns off the whole feature.

**Change.**

1. A `leaderboard.enabled` flag in Vercel Global Config (read with `@vercel/global-config`). When it's off,
   `/api/leaderboard` returns an empty board and scores are still saved. It can be flipped without a deploy.
2. A `leaderboard.blockedNames` list in the same store, checked by `cleanName` for guests.
3. `scripts/leaderboard-remove.mjs <playerKey>`: an operator script that runs `removePlayer`, adds the key to
   `leaderboard-hidden`, and logs `admin.leaderboard.remove`. Run it locally with the production Upstash
   credentials; there's no admin web route, so no new attack surface.

**Done when** turning the flag off hides the board within a minute, and the script removes a test entry.

### R15. Detection rules on top of R2

Once R2's events reach the log tool, add these rules. They use Vercel log-drain field names (`proxy.*`) plus the
R2 events; adjust them for the team's tool. Thresholds are starting points to tune after R3's log-only week.

```yaml
title: Score minting burst
logsource: { product: vercel }
detection:
  sel: { event: score.saved }
  condition: sel | sum(points) by sessionHash > 5000   # timeframe: 1h
---
title: Guest session or name flooding
detection:
  sel: { proxy.path|startswith: /api/session, proxy.method: POST, proxy.statusCode: 201 }
  condition: sel | count() by proxy.clientIp > 60      # timeframe: 10m
---
title: Kid invite probing
detection:
  sel: { event: invite.miss }
  condition: sel | count() by proxy.clientIp > 20      # timeframe: 10m
---
title: Upload signing without confirm
detection:
  sign: { event: file.sign }
  confirm: { event: file.confirmed }
  condition: count(sign) by accountId - count(confirm) by accountId > 5   # timeframe: 1h
---
title: Account deletion or sign-in failure spike
detection:
  del: { event: account.deleted }
  err: { event: auth.error }
  denied: { event: auth.denied }
  condition: del or err or (denied | count() by proxy.clientIp > 50)      # timeframe: 10m
```

`auth.error` should page someone: it usually means the Clerk configuration broke, not an attack.

### R16. Incident runbook: rotation and revocation

Add `docs/security/runbook.md` covering, for each secret, where it lives, how to rotate it and how long it takes:

| Secret | Rotate in | Then |
|---|---|---|
| `CLERK_SECRET_KEY` | Clerk dashboard | Update Vercel env, redeploy |
| `DATABASE_URL` | Neon role password reset | Update Vercel env, redeploy |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Upstash token reset | Update Vercel env, redeploy |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store settings | Update Vercel env, redeploy |

It should also cover mass revocation:

- **End all sessions:** delete the `session:*` keys with `SCAN` and `DEL`. Everyone has to start a new session.
- **Unlink every device for one account:** `delete from kid_devices where account_id = $1`.
- **Unlink every device everywhere:** `delete from kid_devices`.
- **Cancel every open invitation:** `delete from kid_invites where used_at is null`.

**Done when** the runbook exists and one rotation has been practised on a preview environment.

---

## Verification

- Every item adds or changes tests next to the code it touches. `npm test` and `npm run test:e2e` stay green.
- Keep the two reproductions from the review (the deleted private profile on the board, and forged points) as
  regression tests: R1 adds the first; R6 and R11 add the second.
- After Phase 0, run the review again on the merged code and update the tracker above.

## Open questions

1. Is production on a **Clerk production instance**, and on which domain? (R5)
2. Do **preview deployments** share production Upstash, Blob or Clerk credentials? (R13)
3. Are any Vercel Firewall rules, deployment protection or a log drain already set up outside the repo, and how
   long are logs kept? (R2, R3)
4. Which Postgres role does `DATABASE_URL` use today? (R13)
5. Should decks imported only into the browser earn leaderboard points? (R11)
6. Who can read the Vercel project's environment variables? (R13)

## Not covered by the review

Vercel project settings (env scopes, Firewall, deployment protection), the Clerk dashboard, Neon roles and Upstash
ACLs, CI (the repo has none), and the `.agents/` and `.specify/` tooling folders. Git history wasn't scanned for
secrets. Run a history scanner such as `gitleaks detect` before relying on "no secrets in the repo".
