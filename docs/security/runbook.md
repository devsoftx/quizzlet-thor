# Security runbook

How to operate the controls from the [remediation plan](blue-remediation-plan.md): where each secret
lives and how to rotate it, how to cut access quickly, and how to use the leaderboard switches, the
cleanup job and the security log.

Practise one rotation on a preview environment before you need it for real, and note the date here:
_not yet practised._

## Secrets

| Secret | Used for | Rotate in | Then | Effect of rotating |
|---|---|---|---|---|
| `CLERK_SECRET_KEY` | Checking parent sign-ins, deleting sign-in accounts | Clerk dashboard | Update the Vercel env var, redeploy | Parents stay signed in; requests fail between rotation and redeploy |
| `DATABASE_URL` | The running app's database connection (role `quizzlet_app`, see below) | Neon: reset the role's password | Update the Vercel env var, redeploy | Account features answer 500 until the redeploy |
| `DATABASE_URL_MIGRATIONS` | Migrations only (owner role): the production build's migration step and `npm run db:migrate` | Neon: reset the owner role's password | Update the Vercel env var (Production), and anywhere else migrations are run from | None for the running app; production deploys fail at the migration step until it's updated |
| `KV_REST_API_TOKEN` / `UPSTASH_REDIS_REST_TOKEN` | Sessions, scores, leaderboard | Upstash: reset the token | Update the Vercel env var, redeploy | Sessions and scores fail until the redeploy; stored data is kept |
| `BLOB_READ_WRITE_TOKEN` | Private file storage | The Blob store's settings in Vercel | Update the Vercel env var, redeploy | Uploads and file links fail until the redeploy |
| `CRON_SECRET` | Lets Vercel Cron call `/api/cron` | Generate a new random value (32+ characters) | Update the Vercel env var, redeploy | The daily cleanup is refused (401) until both match |
| `GLOBAL_CONFIG` | Reading the leaderboard switches | The Global Config store's tokens in Vercel | Update the Vercel env var, redeploy | The last switch values read are kept until the redeploy |

After any rotation: check `/api/session` (200), sign in as a parent, open My files, and look for
`request.error` and `auth.error` events in the log.

A leaked secret is rotated **first** and investigated second.

## Cutting access

| Goal | How |
|---|---|
| End every session | Delete the `session:*` keys in Redis (`SCAN` with `MATCH session:*`, then `DEL`). Everyone starts a new session; no points are lost. |
| Unlink every device of one account | `delete from kid_devices where account_id = $1;` |
| Unlink every device everywhere | `delete from kid_devices;` |
| Cancel every open invitation | `delete from kid_invites where used_at is null;` |
| Sign one parent out everywhere | Revoke the user's sessions in the Clerk dashboard |
| Stop all sign-ins | Rotate `CLERK_SECRET_KEY` (see above) |

A session for a kid profile is checked against the database on every request, so deleting a device
row, a profile or an account ends its sessions at their next request; there is nothing else to clear.

## Leaderboard: switch off, block a nickname, remove an entry

The switches live in one **Vercel Global Config** item named `leaderboard`. Create a Global Config store
in the Vercel dashboard and connect it to the project, so the `GLOBAL_CONFIG` environment variable is set,
then add the item:

```json
{ "enabled": true, "blockedNames": [] }
```

- **Hide the board:** set `"enabled": false`. `/api/leaderboard` answers with an empty board; points are
  still saved. Each function instance re-reads the item every 30 seconds, so allow up to a minute.
- **Block a nickname:** add an entry to `blockedNames`. A guest nickname that *contains* an entry is
  refused, ignoring case, spaces and punctuation (`"badword"` also blocks `Bad-Word 7`), so keep entries
  specific. Kid profile nicknames are chosen by a signed-in parent and aren't checked against this list.
  A built-in list of English and Spanish swearing and slurs (`server/names.ts`) is always on, for guests
  and kid profiles alike, and needs no Global Config; it also refuses a nickname that mixes letters from
  two alphabets.
- **Remove an entry** (a bad name, a forged score). First look, then remove:

  ```bash
  vercel env run -e production -- node scripts/leaderboard-remove.mjs "<nickname>"
  ```

  ```bash
  vercel env run -e production -- node scripts/leaderboard-remove.mjs "<nickname>" --yes
  ```

  For a kid profile use its key, `p:<profileId>` (the id is in the log events). The entry, name and
  total are removed and the key is added to `leaderboard-removed`. A removed player is **never listed
  again**: not if the nickname is used again, not when a kid profile starts a new session, not when its
  parent switches the leaderboard on. Points still count for the player privately. To undo a removal,
  run `SREM leaderboard-removed "<player key>"` against the Redis database. The script prints an
  `admin.leaderboard.remove` log line; keep it with the incident notes.
- **Clear what deleted profiles left behind** (once, after deploying the session checks). Before sessions
  were checked on every request, a score saved within an hour of a profile's deletion recreated that
  kid's total and nickname, possibly on the public board. This finds every `p:<profileId>` with
  leaderboard data and no profile in the database, and removes it the same way as above. First look,
  then remove:

  ```bash
  vercel env run -e production -- node scripts/cleanup-orphan-players.mjs
  ```

  ```bash
  vercel env run -e production -- node scripts/cleanup-orphan-players.mjs --yes
  ```

  It needs `DATABASE_URL` from the same environment as Redis. If every profile looks deleted it assumes
  the database is the wrong one and removes nothing.

With no Global Config connected, the board is on and nothing is blocked.

## The daily cleanup (`/api/cron`)

Scheduled in `vercel.json` (04:17 UTC). It needs `CRON_SECRET` set in the project: Vercel sends it as a
bearer token, and the route refuses to run without it (503) or with a wrong one (401).

It does two things and logs both:

- `leaderboard.pruned`: keeps the top 1,000 guest entries and removes the rest. Kid profiles are never
  removed.
- `file.orphan.deleted`: deletes uploads that were started and never saved. Starting an upload leaves a
  reservation record; if the file isn't saved, the record expires after 15 minutes and stays. A day
  later the job deletes whatever was uploaded to that path and drops the record. (The same account's
  next upload clears its own abandoned ones sooner.)

The job only deletes a path the database has on record as "started, never saved". It never deletes a
file because a record is *missing*, so pointing it at the wrong or an empty database deletes nothing.
The other side of that: uploads left unconfirmed **before** this change have no such record and are not
removed by the job. If storage use suggests there are some, compare the Blob store's `users/` folder
with the `files` table by hand, and delete with care.

To run it by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<production-domain>/api/cron
```

Also set a memory or usage alert on the Upstash database: the cleanup bounds guest data, the alert tells
you if something else grows.

## The security log

Every security-relevant action writes one JSON line (`"kind":"security"`) to the function's output:

```json
{"route":"/api/me","ts":"2026-11-18T06:00:00.000Z","kind":"security","event":"auth.denied"}
```

Lines carry ids and outcomes only: never a token, cookie, invitation secret, file content, display name
or kid nickname. A session appears as `sessionHash`, which can't be turned back into the cookie.

| Events | Meaning |
|---|---|
| `auth.denied`, `auth.error` | A request without a valid sign-in; the sign-in provider itself failing |
| `account.created`, `account.deleted` | |
| `profile.created`, `profile.deleted`, `profile.visibility` | `listed` is the leaderboard choice |
| `invite.created`, `invite.cancelled`, `invite.miss` | `miss`: an unknown, used or expired invitation token |
| `device.linked`, `device.unlinked` | `by`: `parent`, `kid`, or `replaced` (the device joined again) |
| `session.started`, `session.revoked` | `sessionKind`: `guest`, `profile` or `kid` |
| `session.name_taken`, `session.name_blocked` | A guest nickname refused |
| `score.saved`, `score.replay`, `score.conflict`, `score.limited` | `limited`: answers arriving faster than the pace limit (429) |
| `file.sign`, `file.sign.refused`, `file.confirmed`, `file.rejected`, `file.deleted` | `reason` says why |
| `deck.created`, `deck.deleted` | |
| `request.cross_site`, `request.error` | A write from another site (403); an unexpected error (500, with `requestId`) |
| `csp.violation` | A browser's Content-Security-Policy report |
| `leaderboard.pruned`, `file.orphan.deleted`, `cron.denied`, `cron.error` | The daily cleanup |
| `flags.error` | Global Config couldn't be read |

Vercel keeps runtime logs only briefly. Set up a **log drain** to the team's log tool and record here
which tool and how long it keeps logs: _not set up yet._ The alert rules to add there are in
[detections.yaml](detections.yaml).

## Response headers and the Content-Security-Policy

`vercel.json` sends the headers on every route. Enforced now: `frame-ancestors 'none'`, `base-uri 'self'`,
`object-src 'none'`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
The full policy is sent as `Content-Security-Policy-Report-Only`, and browsers report violations to
`/api/csp-report` (logged as `csp.violation`).

To switch the full policy to enforcing:

1. In the report-only policy, replace `https://*.clerk.accounts.dev` (Clerk development instances) with
   the production instance's own host (`https://clerk.<your-domain>`), in `script-src` and `connect-src`.
2. Use the site for a few days: sign in and out, upload and open a file, study a deck. Then look at the
   `csp.violation` events. Each `blocked` origin is either something the app needs (add it to the
   directive named in `directive`) or something that shouldn't be there.
3. When a normal week produces no new violations, move the report-only value into
   `Content-Security-Policy` (keeping `report-uri`), and delete the report-only header.

## Database roles (least privilege)

The running app needs to read and write rows, nothing more. Migrations need to create tables, functions
and triggers. Keep them apart:

1. As the database owner, create the app's role. Create it **with SQL**, not in the Neon console: check
   Neon's documentation on roles first, since console-created roles are typically given broad privileges.

   ```sql
   create role quizzlet_app login password '<a long random password>';
   grant connect on database <database> to quizzlet_app;
   grant usage on schema public to quizzlet_app;
   grant select, insert, update, delete on
     accounts, kid_profiles, decks, deck_assignments, files, file_reservations, kid_invites, kid_devices
     to quizzlet_app;
   ```

   (Checked against PostgreSQL 16: with these grants every statement the app sends works, including the
   limit triggers, and `drop table`, `create table`, `alter table`, `truncate` and replacing a trigger
   function are all refused.)
2. Put `quizzlet_app`'s connection string in the production `DATABASE_URL`.
3. Keep the owner's connection string as `DATABASE_URL_MIGRATIONS`, available only where migrations are
   run. `npm run db:migrate` uses it when set.

   Production deploys run migrations in the build (`npm run db:migrate:deploy`, from `vercel.json`), so the
   build needs this variable as a Production env var. Vercel gives a project's env vars to its functions as
   well as its build. The app never reads `DATABASE_URL_MIGRATIONS`, but the owner's connection string would
   still be in every function's environment. If that's not acceptable, don't set it on Vercel: run migrations
   from somewhere else, and take the migration step out of `vercel.json`'s `buildCommand`. The build would
   otherwise migrate with `DATABASE_URL`, which the app's role can't do. Every deploy would then fail at that
   step.
4. After a migration that adds a table, grant the app's role access to it (extend the `grant` above).

Related, from the plan (R13): give preview deployments their own Upstash database, Blob store and Neon
branch, or none, so a preview can never write to production data; and review who can read the project's
environment variables.

## Rate limits (Vercel Firewall)

Not in the repository: these are rate-limit rules in the project's Vercel Firewall, per IP. Start each
rule in log-only mode for a week, compare with real traffic, then switch it to deny (429). A classroom
often shares one IP address, so the limits allow for about 30 kids at once.

| Route | Method | Limit per IP |
|---|---|---|
| `/api/session` | POST | 60 / 10 min |
| `/api/score` | POST | 600 / 1 min |
| `/api/kid` | POST | 60 / 10 min |
| `/api/files` | POST | 60 / 10 min |
| `/api/me`, `/api/profiles`, `/api/decks`, `/api/invites` | all | 600 / 5 min |
| `/api/csp-report` | POST | 60 / 10 min |

Record here when each rule was created and when it was switched to deny: _not set up yet._

The application has its own limit that doesn't depend on these: answers can't be saved faster than one
every 2 seconds after a burst of 20 (`score.limited`). It applies to each session and, across sessions, to
each player, so starting new sessions doesn't get around it. (A kid profile can be on up to 10 linked
devices, so its shared allowance across sessions is 10 times that.) What it can't stop is someone
starting sessions under many different nicknames; that is what the `/api/session` rule above is for.

## When something looks wrong

1. **Contain.** Rotate a leaked secret; hide the leaderboard; unlink devices or end sessions (above).
2. **Look.** Filter the log drain by `accountId`, `profileId` or `sessionHash` around the time in question.
3. **Fix the data.** Remove a leaderboard entry with the script; a parent can delete a profile or their
   account, which removes its stored data.
4. **Write it down.** What happened, when, what was changed, and which rule in `detections.yaml` would
   have caught it sooner.
