# Quizzlet ⚡

A small personal flashcard app. Decks are YAML files of multiple-choice
questions. Pick an answer and the card flips over to show whether you got it
right, the correct answer and an optional explanation. At the end you get a
score, a review of every card, and a button to retry only the ones you missed.

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
| `npm run typecheck` | TypeScript check                           |
| `npm run build`     | Build a static site into `dist/`           |

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
- pick a profile on the "Who's studying?" screen to start that kid's 60-minute session;
- choose per profile whether the nickname appears on the public leaderboard
  (off by default; points still count privately);
- change settings (name, theme, card order) or delete the account, which also
  removes every profile and its leaderboard entry.

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
   production only), then create the tables:

   ```bash
   vercel integration add neon --billing-plan free_v3 --meta region=iad1 -e production --no-env-pull
   vercel env run -e production -- npm run db:migrate
   ```

Without these, the site simply runs in guest-only mode.

### Local development

`npm run dev` works without any keys. A **Sign in (local dev)** button signs
you in as a made-up parent id; use two different ids to try two separate
parents. Data is kept in memory.

Don't put production database URLs in `.env.local`: the dev server loads it.

## Project layout

```
decks/                 your YAML decks
api/                   Vercel Functions (session, score, leaderboard, me, profiles)
server/                API handlers, sign-in (auth.ts), accounts database, Redis store
db/migrations/         SQL migrations (npm run db:migrate)
src/deck.ts            YAML parsing, validation and shuffling
src/library.ts         loads decks from decks/ and local storage, best scores
src/components/        DeckList, Quiz, FlipCard, Results
src/styles.css         all styling (light and dark mode)
```
