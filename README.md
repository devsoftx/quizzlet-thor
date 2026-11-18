# Quizzlet ⚡

A small personal flashcard app. Decks are YAML files of multiple-choice
questions. Pick an answer and the card flips over to show whether you got it
right, the correct answer and an optional explanation. At the end you get a
score, a review of every card, and a button to retry only the ones you missed.

Search decks by title or description, preview a deck before starting, and use
the results screen to review answers or practice missed questions. The
leaderboard is optional to view. A guest's nickname is public on the leaderboard
when they earn points; use a nickname rather than a real name. A parent-managed
profile is private on that board unless its adult enables visibility.

Nicknames use letters from one alphabet and can't contain a blocked word
(`server/names.ts`). To take a guest off the board afterwards:

```bash
vercel env run -e production -- node scripts/remove-player.mjs "<nickname>" --apply
```

Points are sent in batches while studying. If a connection is interrupted,
the app may not know whether the latest batch was saved until it can retry;
leaving or closing the tab can lose queued work. A current round's question
position and answer history are not restored after a reload.

The server keeps each session's streak itself and caps how fast a session can
save answers (20 at once, then one per 1.5 seconds). A save over the cap is
answered 429 and waits in the app until it fits. The server still takes the
browser's word for which answers were right.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Start the app with live reload             |
| `npm test`          | Run the unit tests (also validates `decks/`); see below for the Redis ones |
| `npm run test:e2e`  | Run the end-to-end tests in a real browser |
| `npm run typecheck` | TypeScript check                           |
| `npm run build`     | Build a static site into `dist/`           |

### Tests that need Redis or PostgreSQL

`server/store.test.ts` and `scripts/maintenance.test.ts` run the Redis code
(the score script, rate limits, the maintenance scripts) against a real,
throwaway Redis. `npm test` runs them when `redis-server` is installed and
skips them otherwise; with Docker instead:

```bash
scripts/test-redis-store.sh
```

The account database code runs against PGlite (an in-process Postgres) in
`npm test`. One more suite repeats it on a real PostgreSQL in Docker, with
requests that truly overlap (this is what proves the per-account limits hold):

```bash
scripts/test-foundation-postgres.sh
```

### End-to-end tests

The tests in `e2e/` use [Playwright](https://playwright.dev) to drive the
real app in Chromium (desktop, plus a phone-sized run of the core journey).
The first time, install the browser:

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

They start their own dev server on port 5181 with **every real service key
blanked** (database, Redis, Blob, Clerk), so they always run on in-memory data
with the local sign-in, never against production, whatever is in `.env.local`.
Each test makes its own guest names and parent ids, so tests run in parallel
and in any order.

| File                    | Covers                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `guest.e2e.ts`          | Welcome screen, starting, resuming and ending a guest session          |
| `quiz.e2e.ts`           | Studying: feedback, points and streak bonus, results, retry, keyboard   |
| `library.e2e.ts`        | Importing, searching and filtering decks; broken or hidden decks; template |
| `parent.e2e.ts`         | Sign-in, kid profiles and links, settings, deleting the account, privacy |
| `kid-device.e2e.ts`     | Invitation links, studying on a kid's own device, removing a device    |
| `decks-and-files.e2e.ts`| Private decks (who sees them), study files and their limits            |
| `errors.e2e.ts`         | No connection, server errors, refused saves, sessions ending          |
| `api.e2e.ts`            | The API's rules: who may call what, input checks, counting a save once |
| `security.e2e.ts`       | Response headers, framing, requests from other sites, odd cookies and bodies, limits |
| `a11y.e2e.ts`           | Automated accessibility checks (axe-core, WCAG 2.2 AA) on every screen  |

Bugs that were fixed have a test named after them (for example, a fast double
tap skipping a card), so they can't quietly come back. On failure, Playwright
keeps a trace and screenshot: `npm run test:e2e:report` opens them.

Every test also fails if the page does something the content security policy
doesn't allow (see [Security](#security)).

## Adding decks

Start from the template: use **Download template** in the app, or copy
[`public/deck-template.yaml`](public/deck-template.yaml). It's a small,
commented deck that shows every option.

There are two ways to add a deck:

1. **Drop a `.yaml` / `.yml` file into the [`decks/`](decks) folder.** It shows
   up in the app right away while `npm run dev` is running.
2. **Import it in the browser** with the *Import YAML…* button (or drag the file
   onto the page). Imported decks are saved in your browser's local storage.

**Only decks with `enabled: true` are shown.** Set `enabled: false` (or leave
the line out) to hide a deck without deleting it; hidden decks are listed in a
collapsed "hidden (not enabled)" section at the bottom of the deck list.

A deck with mistakes still shows up in the list, with a description of what's
wrong, so you can fix the file — unless it isn't enabled.

## Deck format

```yaml
title: Norse Mythology            # optional, defaults to the file name
description: Gods and realms      # optional
subject: History                  # optional, author-provided category
enabled: true                     # required to show the deck (true / false)
shuffle: true                     # shuffle card order (default: true)
shuffleOptions: true              # shuffle the options on each card (default: true)

cards:
  - question: Who is Thor's father?
    options:
      - Odin
      - Loki
      - Tyr
      - Heimdall
    answer: Odin                  # must match one of the options
    explanation: Odin, the All-Father, rules Asgard.   # optional

  - question: How many realms are there?
    options: [7, 9, 12]           # short list syntax works too
    answer: 9
    shuffleOptions: false         # per-card override (handy for "All of the above")
```

Rules:

- `enabled: true` shows the deck; `enabled: false` or no `enabled` line hides
  it. (`enabled` / `disabled` also work as values.)
- Each card needs a `question`, at least two `options`, and an `answer`.
- `answer` is the **text** of the correct option (matched exactly, or
  ignoring upper/lower case).
- Numbers are fine as options (`[7, 9, 12]`); they're treated as text.
- Wrap text in quotes if it contains a `:` followed by a space, or starts with
  a special character like `*`, `&`, `!`, `[` or `{`.

## Keyboard shortcuts

| Key                          | Action               |
| ---------------------------- | -------------------- |
| `1`–`9` or `A`–`J`           | Pick an answer       |
| `Enter`, `Space` or `→`      | Next card (once flipped) |

## Parent & teacher accounts

Kids play as **guests** with just a nickname. A **parent or teacher** can sign in
with Google. Kids never have accounts of their own: Clerk's terms don't allow storing
data for users under 16 without verifiable parental consent.

A signed-in parent can:

- create up to 20 **kid profiles**: a nickname, grade, color and emoji only — no real names;
- pick a profile on the "Who's studying?" screen to start that kid's 60-minute session,
  and see each kid's all-time points there (kids see theirs on their own home screen);
- **link a kid's own device**: each new profile gets an invitation link (one use,
  7 days). The kid opens it on their tablet or computer and that device studies
  as them, still with no email, password or account. The parent sees each linked
  device under Kid profiles → Devices and can remove it or make a new link. A
  device stays linked for 180 days, then needs a new link;
- choose per profile whether the nickname appears on the public leaderboard
  (off by default; points still count privately);
- keep **private decks** (My decks): upload YAML decks into the account, switch
  each one on or off, and pick which kids see it. Kids see them next to the
  shared decks;
- keep **private files** (My files): PDFs, Word (.docx), PNG, JPEG and WebP
  study material, up to 15 MB each (20 files, 50 MB per account), stored in a
  private Vercel Blob store and opened only through the parent's sign-in;
- change settings (name, theme, card order) or delete the account, which also
  removes every profile, deck and file, and the profiles' leaderboard entries.

### Setup

1. **Clerk:** add it from the Vercel Marketplace, which sets
   `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for you (a
   development instance works on `*.vercel.app`), then turn on Google in the
   Clerk dashboard:

   ```bash
   vercel integration add clerk --billing-plan hobby_2025_08 --no-env-pull
   ```

   (Setting `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` yourself works too.)
2. **Database:** add Neon Postgres from the Vercel Marketplace (`DATABASE_URL`,
   production only), then create or update the tables (safe to re-run):

   ```bash
   vercel integration add neon --billing-plan free_v3 --meta region=iad1 -e production --no-env-pull
   vercel env run -e production -- npm run db:migrate
   ```

   Run `npm run db:migrate` again **before** deploying a version that adds a
   file to `db/migrations/`: the new code expects the new columns.

3. **Files:** create a private Blob store connected to production:

   ```bash
   vercel blob create-store quizzlet-files --access private --environment production --yes
   ```

   This also rewrites `.env.local` with the Development variables; remove the
   Clerk keys from it if you want to keep the local sign-in stand-in.

Without these, the site simply runs in guest-only mode (and My files says
storage isn't set up).

### Local development

`npm run dev` works without any keys. A **Sign in (local dev)** button signs
you in as a made-up parent id; use two different ids to try two separate
parents. Accounts, decks and uploaded files are kept in memory.

The made-up sign-in and the in-memory stores exist only on a developer's
machine: never on Vercel, never when `NODE_ENV` is `production`, and the
sign-in only with `QUIZZLET_DEV_AUTH=1` (the dev server sets it) and only for
requests to `localhost`.

Don't put production database URLs in `.env.local`: the dev server loads it.

## Security

A red-team review and what was done about it are in
[`docs/red-remediation-plan.md`](docs/red-remediation-plan.md). In short:

- **Response headers** come from [`vercel.json`](vercel.json); `npm run dev`
  and `npm run preview` send the same ones. The page can't be framed by other
  sites. The content security policy is **report-only** for now: the browser
  logs what it would block, and the end-to-end tests fail on any report. Its
  Clerk hosts are for a development instance (`*.clerk.accounts.dev`); for a
  Clerk production instance add `clerk.<your-domain>` to `script-src` and
  `connect-src`.
- **Requests that change something** must come from this site (the `Origin`
  header) and carry JSON.
- **Rate limits** per IP address on the routes that need no sign-in
  (`RATE_LIMITS` in `server/route.ts`), counted in Redis.
- **Security events** (refused sign-ins, deletions, invitation links, refused
  saves and uploads, unhandled errors) are written to the function logs as one
  JSON line each, with ids and outcomes only (`server/log.ts`).
- **Maintenance scripts** in `scripts/` only report what they would do unless
  run with `--apply`: `remove-player.mjs`, and the one-off
  `cleanup-orphan-players.mjs`, `cleanup-guest-names.mjs` and
  `cleanup-orphan-blobs.mjs`.

## Project layout

```
decks/                 your YAML decks
api/                   Vercel Functions (session, score, leaderboard, me, profiles, decks, files, invites, kid)
server/                API handlers, sign-in (auth.ts), accounts database, file storage (files.ts), Redis store,
                       request checks and rate limits (route.ts), nickname rules (names.ts), security log (log.ts)
db/migrations/         SQL migrations (npm run db:migrate)
scripts/               migrations, maintenance and cleanup scripts, service-backed test runners
vercel.json            response headers (security headers, content policy)
e2e/                   end-to-end tests (Playwright); helpers in e2e/support.ts
src/deck.ts            YAML parsing, validation and shuffling
src/library.ts         loads decks from decks/ and local storage, best scores
src/components/        DeckList, Quiz, FlipCard, Results, parent screens (profiles, My decks, My files, settings)
src/styles.css         all styling (light and dark mode)
```
