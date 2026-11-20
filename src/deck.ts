import { parse } from "yaml";
import { deckMessagesEn, type DeckMessages } from "./deck-messages.js";

export type { DeckMessages };

/** How hard a card is for the deck's audience. Authors set it per card or for the whole deck. */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
/** What a card without a difficulty (on itself or on its deck) counts as. */
export const DEFAULT_DIFFICULTY: Difficulty = "medium";

export const isDifficulty = (value: unknown): value is Difficulty => DIFFICULTIES.includes(value as Difficulty);

/** One multiple-choice flashcard. */
export interface Card {
  question: string;
  options: string[];
  /** Always exactly one of `options`. */
  answer: string;
  explanation?: string;
  /** Per-card override of the deck's `shuffleOptions`. */
  shuffleOptions?: boolean;
  /** Per-card override of the deck's `difficulty`. */
  difficulty?: Difficulty;
}

export interface Deck {
  title: string;
  description?: string;
  /** Optional, author-supplied subject; missing means uncategorized. */
  subject?: string;
  /**
   * The language the cards are written in (a BCP 47 code such as "en" or "es"),
   * so the app can mark them for screen readers and filter by it. Missing means
   * unknown: the text then takes the app's own language.
   */
  language?: string;
  /** Only decks with `enabled: true` are shown in the app (default: false). */
  enabled: boolean;
  /** Shuffle card order each session (default: true). */
  shuffle: boolean;
  /** Shuffle the options inside each card (default: true). */
  shuffleOptions: boolean;
  /** The difficulty of cards that don't set their own. */
  difficulty?: Difficulty;
  cards: Card[];
}

/** A card's difficulty: its own, else its deck's, else medium. */
export function cardDifficulty(card: Card, deck?: Pick<Deck, "difficulty">): Difficulty {
  return card.difficulty ?? deck?.difficulty ?? DEFAULT_DIFFICULTY;
}

/**
 * Reads a `difficulty` value: undefined when it isn't there, null when it isn't
 * one of the three words (upper/lower case doesn't matter).
 */
function parseDifficulty(raw: unknown): Difficulty | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  const word = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return isDifficulty(word) ? word : null;
}

const shown = (raw: unknown) => (typeof raw === "string" ? raw : JSON.stringify(raw));

export type ParseResult =
  | { ok: true; deck: Deck }
  /** `enabled` is null when it can't be read (broken YAML or a bad value). */
  | { ok: false; errors: string[]; enabled: boolean | null };

/**
 * Reads the deck-level `enabled` flag. Missing means disabled. Accepts
 * true/false, plus the words "enabled"/"disabled".
 */
function parseEnabled(raw: unknown, messages: DeckMessages): { value: boolean | null; error?: string } {
  if (raw === undefined || raw === null) return { value: false };
  if (typeof raw === "boolean") return { value: raw };
  if (typeof raw === "string") {
    const word = raw.trim().toLowerCase();
    if (word === "true" || word === "enabled") return { value: true };
    if (word === "false" || word === "disabled") return { value: false };
  }
  const got = typeof raw === "string" ? raw : JSON.stringify(raw);
  return { value: null, error: messages.enabledInvalid(got) };
}

type Rng = () => number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** YAML turns `1969` or `yes` into numbers/booleans; treat them as text. */
function toText(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function optionalBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function preview(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function parseCard(raw: unknown, index: number, errors: string[], messages: DeckMessages): Card | null {
  const label = messages.card(index + 1);
  if (!isRecord(raw)) {
    errors.push(messages.notAMapping(label));
    return null;
  }

  const question = toText(raw.question);
  if (!question) {
    errors.push(messages.missingQuestion(label));
    return null;
  }
  const where = messages.cardWithQuestion(label, preview(question));

  if (!Array.isArray(raw.options) || raw.options.length < 2) {
    errors.push(messages.needsOptions(where));
    return null;
  }
  const options: string[] = [];
  for (const [i, opt] of raw.options.entries()) {
    const text = toText(opt);
    if (!text) {
      errors.push(messages.optionEmpty(where, i + 1));
      return null;
    }
    if (options.includes(text)) {
      errors.push(messages.optionTwice(where, text));
      return null;
    }
    options.push(text);
  }

  const answerText = toText(raw.answer);
  if (!answerText) {
    errors.push(messages.missingAnswer(where));
    return null;
  }
  // Exact match first, then a forgiving case-insensitive match.
  const answer =
    options.find((o) => o === answerText) ??
    options.find((o) => o.toLowerCase() === answerText.toLowerCase());
  if (!answer) {
    errors.push(messages.answerNotAnOption(where, answerText));
    return null;
  }

  const card: Card = { question, options, answer };
  const explanation = toText(raw.explanation);
  if (explanation) card.explanation = explanation;
  if (typeof raw.shuffleOptions === "boolean") card.shuffleOptions = raw.shuffleOptions;
  const difficulty = parseDifficulty(raw.difficulty);
  if (difficulty === null) {
    errors.push(messages.difficultyInvalid(where, shown(raw.difficulty)));
    return null;
  }
  if (difficulty) card.difficulty = difficulty;
  return card;
}

/**
 * A deck's `language`: a BCP 47 code ("en", "es", "es-MX"), tidied to its
 * canonical form. Undefined when the file doesn't say; null when it's not a code.
 */
function parseLanguage(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw.trim())) return null;
  try {
    return Intl.getCanonicalLocales(raw.trim())[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a deck from YAML. The file is a mapping with a `cards:` list.
 * (A bare list of cards still parses, but it has nowhere to say
 * `enabled: true`, so it is always disabled.)
 *
 * Problems are described with `messages` (English unless the browser asks
 * for another language).
 */
export function parseDeck(source: string, fallbackTitle: string, messages: DeckMessages = deckMessagesEn): ParseResult {
  let data: unknown;
  try {
    data = parse(source);
  } catch (err) {
    return { ok: false, errors: [messages.invalidYaml((err as Error).message)], enabled: null };
  }

  const root = Array.isArray(data) ? { cards: data } : data;
  if (!isRecord(root)) {
    return { ok: false, errors: [messages.needsCards], enabled: null };
  }

  const enabled = parseEnabled(root.enabled, messages);
  const errors: string[] = enabled.error ? [enabled.error] : [];
  if (root.subject !== undefined && (typeof root.subject !== "string" || !root.subject.trim() || root.subject.trim().length > 80)) {
    errors.push(messages.subjectInvalid);
  }
  const language = parseLanguage(root.language);
  if (language === null) errors.push(messages.languageInvalid(typeof root.language === "string" ? root.language : JSON.stringify(root.language)));
  const difficulty = parseDifficulty(root.difficulty);
  if (difficulty === null) errors.push(messages.difficultyInvalid(null, shown(root.difficulty)));

  if (!Array.isArray(root.cards)) {
    errors.push(messages.needsCards);
  } else if (root.cards.length === 0) {
    errors.push(messages.cardsEmpty);
  }
  const cards = (Array.isArray(root.cards) ? root.cards : [])
    .map((raw, i) => parseCard(raw, i, errors, messages))
    .filter((c): c is Card => c !== null);
  if (errors.length > 0 || enabled.value === null) {
    return { ok: false, errors, enabled: enabled.value };
  }

  return {
    ok: true,
    deck: {
      title: toText(root.title) || fallbackTitle,
      description: toText(root.description) || undefined,
      ...(typeof root.subject === "string" && root.subject.trim() ? { subject: root.subject.trim() } : {}),
      ...(language ? { language } : {}),
      enabled: enabled.value,
      shuffle: optionalBool(root.shuffle, true),
      shuffleOptions: optionalBool(root.shuffleOptions, true),
      ...(difficulty ? { difficulty } : {}),
      cards,
    },
  };
}

export function shuffled<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Order the cards (and their options) for one study session. */
export function buildSession(
  deck: Deck,
  cards: readonly Card[] = deck.cards,
  rng: Rng = Math.random,
): Card[] {
  const ordered = deck.shuffle ? shuffled(cards, rng) : [...cards];
  return ordered.map((card) => ({
    ...card,
    options:
      (card.shuffleOptions ?? deck.shuffleOptions)
        ? shuffled(card.options, rng)
        : [...card.options],
  }));
}

/** Turn "norse-mythology.yaml" into "Norse mythology". */
export function titleFromFileName(fileName: string, messages: DeckMessages = deckMessagesEn): string {
  const base = fileName.replace(/^.*\//, "").replace(/\.ya?ml$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : messages.untitled;
}
