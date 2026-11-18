import { deckIsFor, type AccountDeck } from "./account-shared";

export { deckIsFor };
import { parseDeck, titleFromFileName, type Deck, type DeckMessages } from "./deck";

/** bundled: decks/ folder · imported: this browser only · account: a parent's private deck */
export type DeckSource = "bundled" | "imported" | "account";

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

/** The base language of a deck ("es" for "es-MX"), or null when the deck doesn't say. */
export function deckLanguage(deck: Deck): string | null {
  return deck.language ? deck.language.split("-")[0].toLowerCase() : null;
}

/**
 * Search only actual deck metadata. Missing subjects are explicitly uncategorized.
 * `language` (optional) keeps decks written in that language ("es", "en").
 */
export function filterDecks(entries: DeckEntry[], query: string, subject: string, language = ""): DeckEntry[] {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (!entry.ok || !entry.deck.enabled) return false;
    const text = `${entry.deck.title} ${entry.deck.description ?? ""}`.toLocaleLowerCase();
    const matchesSubject = !subject || (subject === "__uncategorized__" ? !entry.deck.subject : entry.deck.subject === subject);
    const matchesLanguage = !language || deckLanguage(entry.deck) === language;
    return matchesSubject && matchesLanguage && (!q || text.includes(q));
  });
}

export interface StoredDeck {
  fileName: string;
  text: string;
}

/** The downloadable deck template, served from public/ (one per app language). */
export const TEMPLATE_URLS = { en: "/deck-template.yaml", es: "/deck-template.es.yaml" } as const;
/** The English template (older name, kept for imports). */
export const TEMPLATE_URL = TEMPLATE_URLS.en;

const IMPORTED_KEY = "quizzlet:imported-decks";
const BEST_KEY = "quizzlet:best-scores";

// Every .yaml/.yml file in /decks is bundled in. In dev, adding or editing a
// file there updates the app automatically.
const bundledFiles = import.meta.glob<string>(["/decks/*.yaml", "/decks/*.yml"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function toEntry(id: string, fileName: string, source: DeckSource, text: string, messages?: DeckMessages): DeckEntry {
  const result = parseDeck(text, titleFromFileName(fileName, messages), messages);
  return { id, fileName, source, ...result };
}

/**
 * A refused deck's problems in the app's language. The server describes them
 * in English, so read the same YAML here again; if it finds nothing (the server
 * checks a few more things), keep what the server said.
 */
export function deckProblems(fileName: string, text: string, serverDetails: string[], messages?: DeckMessages): string[] {
  const local = parseDeck(text, titleFromFileName(fileName, messages), messages);
  return !local.ok && local.errors.length ? local.errors : serverDetails;
}

/** Decks are listed by title (broken decks by file name). */
function sortName(entry: DeckEntry): string {
  return entry.ok ? entry.deck.title : entry.fileName;
}

/**
 * The decks in decks/. They are written in English unless their file says
 * otherwise (`language: es`), so screen readers read them in an English voice
 * even when the app is in Spanish.
 */
export function loadBundledDecks(messages?: DeckMessages): DeckEntry[] {
  return Object.entries(bundledFiles)
    .map(([path, text]) => {
      const fileName = path.replace(/^.*\//, "");
      const entry = toEntry(`bundled:${fileName}`, fileName, "bundled", text, messages);
      return entry.ok && !entry.deck.language ? { ...entry, deck: { ...entry.deck, language: "en" } } : entry;
    })
    .sort((a, b) => sortName(a).localeCompare(sortName(b)));
}

// --- A parent's private decks ---

/** An account deck as a deck-list entry. Its title and on/off come from the account, not the file. */
export function accountDeckEntry(deck: AccountDeck, messages?: DeckMessages): DeckEntry {
  const result = parseDeck(deck.yaml, deck.title, messages);
  const base = { id: `account:${deck.id}`, fileName: deck.title, source: "account" as const };
  return result.ok
    ? { ...base, ok: true, deck: { ...result.deck, title: deck.title, enabled: deck.enabled } }
    : { ...base, ...result, enabled: deck.enabled };
}

/** The account decks a kid profile can study, by title. */
export function accountDecksFor(decks: AccountDeck[], profileId: string, messages?: DeckMessages): DeckEntry[] {
  return decks
    .filter((d) => deckIsFor(d, profileId))
    .map((d) => accountDeckEntry(d, messages))
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
    ? (stored as (Partial<StoredDeck> | null)[]).filter(
        (d): d is StoredDeck =>
          typeof d?.fileName === "string" && typeof d?.text === "string",
      )
    : [];
}

/** The raw text of decks imported into this browser (to copy them into an account). */
export function loadImportedTexts(): StoredDeck[] {
  return readImported();
}

/** A deck imported into this browser, as a deck-list entry. */
export function importedEntry(stored: StoredDeck, messages?: DeckMessages): DeckEntry {
  return toEntry(`imported:${stored.fileName}`, stored.fileName, "imported", stored.text, messages);
}

export function loadImportedDecks(messages?: DeckMessages): DeckEntry[] {
  return readImported().map((d) => importedEntry(d, messages));
}

/** Save an uploaded deck (replacing one with the same file name). */
export function saveImportedDeck(fileName: string, text: string, messages?: DeckMessages): DeckEntry {
  const others = readImported().filter((d) => d.fileName !== fileName);
  writeJson(IMPORTED_KEY, [...others, { fileName, text }]);
  return importedEntry({ fileName, text }, messages);
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
