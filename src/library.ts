import { parseDeck, titleFromFileName, type Deck } from "./deck";

export type DeckSource = "bundled" | "imported";

export type DeckEntry = {
  id: string;
  fileName: string;
  source: DeckSource;
} & ({ ok: true; deck: Deck } | { ok: false; errors: string[]; enabled: boolean | null });

/**
 * Only enabled decks are listed. A broken deck still shows its errors so the
 * author can fix it — unless its file says it's disabled (or doesn't say).
 */
export function isVisible(entry: DeckEntry): boolean {
  return entry.ok ? entry.deck.enabled : entry.enabled !== false;
}

interface StoredDeck {
  fileName: string;
  text: string;
}

const IMPORTED_KEY = "quizzlet:imported-decks";
const BEST_KEY = "quizzlet:best-scores";

// Every .yaml/.yml file in /decks is bundled in. In dev, adding or editing a
// file there updates the app automatically.
const bundledFiles = import.meta.glob<string>(["/decks/*.yaml", "/decks/*.yml"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function toEntry(id: string, fileName: string, source: DeckSource, text: string): DeckEntry {
  const result = parseDeck(text, titleFromFileName(fileName));
  return { id, fileName, source, ...result };
}

/** Decks are listed by title (broken decks by file name). */
function sortName(entry: DeckEntry): string {
  return entry.ok ? entry.deck.title : entry.fileName;
}

export function loadBundledDecks(): DeckEntry[] {
  return Object.entries(bundledFiles)
    .map(([path, text]) => {
      const fileName = path.replace(/^.*\//, "");
      return toEntry(`bundled:${fileName}`, fileName, "bundled", text);
    })
    .sort((a, b) => sortName(a).localeCompare(sortName(b)));
}

// --- localStorage helpers (storage can be missing or blocked; never throw) ---

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: the app still works for this visit.
  }
}

// --- Imported decks (uploaded in the browser, kept in localStorage) ---

function readImported(): StoredDeck[] {
  const stored = readJson<unknown>(IMPORTED_KEY, []);
  return Array.isArray(stored)
    ? stored.filter(
        (d): d is StoredDeck =>
          typeof d?.fileName === "string" && typeof d?.text === "string",
      )
    : [];
}

export function loadImportedDecks(): DeckEntry[] {
  return readImported().map((d) =>
    toEntry(`imported:${d.fileName}`, d.fileName, "imported", d.text),
  );
}

/** Save an uploaded deck (replacing one with the same file name). */
export function saveImportedDeck(fileName: string, text: string): DeckEntry {
  const others = readImported().filter((d) => d.fileName !== fileName);
  writeJson(IMPORTED_KEY, [...others, { fileName, text }]);
  return toEntry(`imported:${fileName}`, fileName, "imported", text);
}

export function removeImportedDeck(fileName: string): void {
  writeJson(
    IMPORTED_KEY,
    readImported().filter((d) => d.fileName !== fileName),
  );
}

// --- Best scores (percent, per deck id) ---

export function loadBestScores(): Record<string, number> {
  const stored = readJson<unknown>(BEST_KEY, {});
  return stored && typeof stored === "object" ? (stored as Record<string, number>) : {};
}

/** Record a score; returns true when it's a new best. */
export function recordScore(deckId: string, percent: number): boolean {
  const best = loadBestScores();
  if ((best[deckId] ?? -1) >= percent) return false;
  writeJson(BEST_KEY, { ...best, [deckId]: percent });
  return true;
}
