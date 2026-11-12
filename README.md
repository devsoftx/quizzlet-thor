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

## Project layout

```
decks/                 your YAML decks
src/deck.ts            YAML parsing, validation and shuffling
src/library.ts         loads decks from decks/ and local storage, best scores
src/components/        DeckList, Quiz, FlipCard, Results
src/styles.css         all styling (light and dark mode)
```
