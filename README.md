# Quizzlet ⚡

A small personal flashcard app. Decks are YAML files of multiple-choice
questions. Pick an answer and the card flips over to show whether you got it
right, the correct answer and an optional explanation. At the end you get a
score, a review of every card, and a button to retry only the ones you missed.

Search decks by title or description, preview a deck before starting, and use
the results screen to review answers or practice missed questions. The
leaderboard is optional to view. A guest's nickname is public on the leaderboard
when they earn points; use a nickname rather than a real name. A nickname
belongs to the browser that first used it (for 30 days after its last session),
so nobody else can add to its points; on another device, pick another nickname
or ask a parent to set up a profile. A parent-managed profile is private on that
board unless its adult enables visibility, and is shown with its emoji.

Points are sent in batches while studying. If a connection is interrupted,
the app may not know whether the latest batch was saved until it can retry;
leaving or closing the tab can lose queued work. A current round's question
position and answer history are not restored after a reload. The server keeps
each session's streak itself and accepts answers no faster than a person can
give them (a burst of 20, then one every 2 seconds, per session and per
player), so a streak bonus can't be claimed and points can't be poured in by a
script.

## Languages

The app speaks **English and Spanish** (Latin American Spanish, informal "tú").
It starts in the browser's language (Spanish when it comes before English in the
browser's preferences, English otherwise), and the **English / Español** switch at
the top of every screen changes it on the spot. The choice is remembered on that
device, for guests, kids on their own linked device and parents alike, and sets
the page's `lang` so screen readers use the right voice. Numbers and dates follow
the language too, as do Clerk's sign-in window, the deck template download and
the messages the server sends (the API itself always answers in English; the
browser translates what it shows).

Decks are written in whatever language their author chooses. A deck can say
which with `language:` (`en`, `es`, `es-MX`…); the decks in `decks/` count as
English unless they say otherwise. Deck text is then marked with its language,
so an English question on a Spanish screen is still read in English. A deck
whose language isn't the app's shows it in the deck list, and once decks come
in more than one language the list can be filtered by it.

To change or add wording, edit [`src/i18n/en.ts`](src/i18n/en.ts) and
[`src/i18n/es.ts`](src/i18n/es.ts): TypeScript fails the build if the Spanish
catalog misses a message or takes different values. A new message from the
server needs its Spanish version in
[`src/i18n/server-messages.ts`](src/i18n/server-messages.ts) (a unit test reads
the server's code and fails when one is missing), and deck validation messages
live in [`src/deck-messages.ts`](src/deck-messages.ts).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Start the app with live reload             |
| `npm test`          | Run the unit tests (also validates `decks/`) |
| `npm run test:e2e`  | Run the end-to-end tests in a real browser |
| `npm run typecheck` | TypeScript check                           |
| `npm run build`     | Build a static site into `dist/`           |

Three more checks run the production storage code against real, disposable
services (the unit tests use in-memory stand-ins and an in-process Postgres):

| Command | What it checks | Needs |
| ------- | -------------- | ----- |
| `python3 scripts/test-redis-score.py` | The Redis Lua scripts: scoring, the pace limit, removed players, nickname claims, pruning | Docker, or `QUIZZLET_REDIS_LOCAL=1` with a local `redis-server` |
| `scripts/test-foundation-postgres.sh` | The account SQL and the limit triggers, including parallel inserts at a limit | Docker |
| `npm test -- server/store.redis.test.ts` | The Redis store against the in-memory one, step by step | A disposable Redis behind an Upstash-compatible REST endpoint (see the file) |
| `npm test -- scripts/cleanup-orphan-players.test.ts` | The one-off cleanup of deleted profiles' leaderboard leftovers | The same Redis; run it on its own (each of these two files empties it) |

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
| `security.e2e.ts`       | The response headers on the wire, framing by another site, the content policy, nickname rules |
| `i18n.e2e.ts`           | Spanish: from the browser's language, the switch, server and deck messages, parents |
| `a11y.e2e.ts`           | Automated accessibility checks (axe-core, WCAG 2.2 AA) on every screen, in both languages |

Bugs that were fixed have a test named after them (for example, a fast double
tap skipping a card), so they can't quietly come back. On failure, Playwright
keeps a trace and screenshot: `npm run test:e2e:report` opens them.

## Adding decks

Start from the template: use **Download template** in the app, or copy
[`public/deck-template.yaml`](public/deck-template.yaml) (in Spanish:
[`public/deck-template.es.yaml`](public/deck-template.es.yaml)). It's a small,
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
language: en                      # optional, the language the cards are in (en, es, es-MX…)
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
- The keys (`title`, `cards`, `question`, `options`, `answer`…) are always
  written in English, whatever language the deck is in.
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
  private Vercel Blob store and opened only through the parent's sign-in. An
  upload counts against those limits from the moment it starts, for 15 minutes
  or until it is saved;
- change settings (name, theme, card order) or delete the account, which also
  removes every profile, deck and file, and the profiles' leaderboard entries.

### Setup

1. **Clerk:** add it from the Vercel Marketplace, which sets
   `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for you, then turn
   on Google in the Clerk dashboard:

   ```bash
   vercel integration add clerk --billing-plan hobby_2025_08 --no-env-pull
   ```

   (Setting `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` yourself works too.)

   A Clerk *development* instance works on `*.vercel.app` and is fine for trying
   things out. **Use a Clerk production instance, on the site's own domain, for
   the real site**: development instances are for testing and have relaxed
   security settings. When you switch, put the production instance's host in the
   Content-Security-Policy in `vercel.json` (see `docs/security/runbook.md`).
2. **Database:** add Neon Postgres from the Vercel Marketplace (`DATABASE_URL`,
   production only), then create or update the tables (safe to re-run):

   ```bash
   vercel integration add neon --billing-plan free_v3 --meta region=iad1 -e production --no-env-pull
   vercel env run -e production -- npm run db:migrate
   ```

   After that, **every production deploy applies new migrations itself**.
   `vercel.json`'s `buildCommand` runs `npm run db:migrate:deploy` once the app
   has built. That step migrates only when `VERCEL_ENV` is `production`, so
   preview and local builds skip it. If a migration fails, the build fails and
   the site keeps running the previous deployment. Each file is applied in one
   transaction, so a failed file changes nothing. Running `npm run db:migrate`
   by hand at the same time is safe: a file is never applied twice.

   A migration runs while the previous deployment is still serving, so write
   it to work with both the old code and the new: add tables and columns first,
   and remove old ones in a later deploy.

   Migrations use `DATABASE_URL_MIGRATIONS` when it's set, so the running app
   can use a role that can't change the schema (`docs/security/runbook.md` has
   the SQL for it, and what that means for the build).

3. **Files:** create a private Blob store connected to production:

   ```bash
   vercel blob create-store quizzlet-files --access private --environment production --yes
   ```

   This also rewrites `.env.local` with the Development variables; remove the
   Clerk keys from it if you want to keep the local sign-in stand-in.

4. **Daily cleanup:** set `CRON_SECRET` to a long random value in the project's
   environment variables. Vercel Cron calls `/api/cron` once a day with it; the
   job trims old guest leaderboard entries and deletes uploads that were started
   and never saved. Without the secret the job refuses to run.
5. **Leaderboard switches (optional):** connect a Vercel Global Config store
   (`GLOBAL_CONFIG`) with a `leaderboard` item to hide the leaderboard or block
   guest nicknames without a deploy. `docs/security/runbook.md` shows the item.

Without these, the site simply runs in guest-only mode (and My files says
storage isn't set up).

### Security

`vercel.json` sets the response headers (the full Content-Security-Policy is in
report-only mode until its reports have been checked). Every write to the API
must come from the site itself and carry JSON. Security-relevant actions are
logged as JSON lines with ids only, never tokens or nicknames.
[`docs/security/`](docs/security) has the remediation plan and its status, the
runbook (rotating secrets, cutting access, the leaderboard switches, the
cleanup job, the log events) and the alert rules to add to a log tool.

### Local development

`npm run dev` works without any keys. A **Sign in (local dev)** button signs
you in as a made-up parent id; use two different ids to try two separate
parents. Accounts, decks and uploaded files are kept in memory.

The made-up sign-in and the in-memory stores exist only on a developer's
machine: never on Vercel, never when `NODE_ENV` is `production`, and the
sign-in only with `QUIZZLET_DEV_AUTH=1` (the dev server sets it) and only for
requests to `localhost`. `npm run dev` and `npm run preview` send the response
headers from `vercel.json`, so what the browser enforces locally is what it
enforces in production.

Don't put production database URLs in `.env.local`: the dev server loads it.

## Project layout

```
decks/                 your YAML decks
api/                   Vercel Functions (session, score, leaderboard, me, profiles, decks, files, invites, kid, cron, csp-report)
server/                API handlers, sign-in (auth.ts), accounts database, file storage (files.ts), Redis store,
                       security log (log.ts), request guard (route.ts), operator switches (flags.ts)
db/migrations/         SQL migrations (applied on each production deploy, or npm run db:migrate)
scripts/               migrations, the leaderboard removal and cleanup tools, checks against real Redis and Postgres
docs/security/         remediation plan, runbook, alert rules
vercel.json            response headers, the daily cleanup schedule
e2e/                   end-to-end tests (Playwright); helpers in e2e/support.ts
src/deck.ts            YAML parsing, validation and shuffling
src/library.ts         loads decks from decks/ and local storage, best scores
src/i18n/              languages: the English and Spanish messages, the language switch's store, server messages in Spanish
src/components/        DeckList, Quiz, FlipCard, Results, parent screens (profiles, My decks, My files, settings)
src/styles.css         all styling (light and dark mode)
```
