import { parse } from "yaml";

/** One multiple-choice flashcard. */
export interface Card {
  question: string;
  options: string[];
  /** Always exactly one of `options`. */
  answer: string;
  explanation?: string;
  /** Per-card override of the deck's `shuffleOptions`. */
  shuffleOptions?: boolean;
}

export interface Deck {
  title: string;
  description?: string;
  /** Only decks with `enabled: true` are shown in the app (default: false). */
  enabled: boolean;
  /** Shuffle card order each session (default: true). */
  shuffle: boolean;
  /** Shuffle the options inside each card (default: true). */
  shuffleOptions: boolean;
  cards: Card[];
}

export type ParseResult =
  | { ok: true; deck: Deck }
  /** `enabled` is null when it can't be read (broken YAML or a bad value). */
  | { ok: false; errors: string[]; enabled: boolean | null };

/**
 * Reads the deck-level `enabled` flag. Missing means disabled. Accepts
 * true/false, plus the words "enabled"/"disabled".
 */
function parseEnabled(raw: unknown): { value: boolean | null; error?: string } {
  if (raw === undefined || raw === null) return { value: false };
  if (typeof raw === "boolean") return { value: raw };
  if (typeof raw === "string") {
    const word = raw.trim().toLowerCase();
    if (word === "true" || word === "enabled") return { value: true };
    if (word === "false" || word === "disabled") return { value: false };
  }
  return { value: null, error: `"enabled" must be true or false (got "${String(raw)}").` };
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

function parseCard(raw: unknown, index: number, errors: string[]): Card | null {
  const label = `Card ${index + 1}`;
  if (!isRecord(raw)) {
    errors.push(`${label}: expected a mapping with question, options and answer.`);
    return null;
  }

  const question = toText(raw.question);
  if (!question) {
    errors.push(`${label}: missing "question".`);
    return null;
  }
  const where = `${label} ("${preview(question)}")`;

  if (!Array.isArray(raw.options) || raw.options.length < 2) {
    errors.push(`${where}: "options" must be a list with at least 2 items.`);
    return null;
  }
  const options: string[] = [];
  for (const [i, opt] of raw.options.entries()) {
    const text = toText(opt);
    if (!text) {
      errors.push(`${where}: option ${i + 1} is empty or not plain text.`);
      return null;
    }
    if (options.includes(text)) {
      errors.push(`${where}: option "${text}" appears twice.`);
      return null;
    }
    options.push(text);
  }

  const answerText = toText(raw.answer);
  if (!answerText) {
    errors.push(`${where}: missing "answer".`);
    return null;
  }
  // Exact match first, then a forgiving case-insensitive match.
  const answer =
    options.find((o) => o === answerText) ??
    options.find((o) => o.toLowerCase() === answerText.toLowerCase());
  if (!answer) {
    errors.push(`${where}: answer "${answerText}" is not one of the options.`);
    return null;
  }

  const card: Card = { question, options, answer };
  const explanation = toText(raw.explanation);
  if (explanation) card.explanation = explanation;
  if (typeof raw.shuffleOptions === "boolean") card.shuffleOptions = raw.shuffleOptions;
  return card;
}

/**
 * Parse a deck from YAML. The file is a mapping with a `cards:` list.
 * (A bare list of cards still parses, but it has nowhere to say
 * `enabled: true`, so it is always disabled.)
 */
export function parseDeck(source: string, fallbackTitle: string): ParseResult {
  let data: unknown;
  try {
    data = parse(source);
  } catch (err) {
    return { ok: false, errors: [`Invalid YAML: ${(err as Error).message}`], enabled: null };
  }

  const root = Array.isArray(data) ? { cards: data } : data;
  if (!isRecord(root)) {
    return { ok: false, errors: ['The file needs a "cards:" list.'], enabled: null };
  }

  const enabled = parseEnabled(root.enabled);
  const errors: string[] = enabled.error ? [enabled.error] : [];

  if (!Array.isArray(root.cards)) {
    errors.push('The file needs a "cards:" list.');
  } else if (root.cards.length === 0) {
    errors.push('"cards" is empty — add at least one card.');
  }
  const cards = (Array.isArray(root.cards) ? root.cards : [])
    .map((raw, i) => parseCard(raw, i, errors))
    .filter((c): c is Card => c !== null);
  if (errors.length > 0 || enabled.value === null) {
    return { ok: false, errors, enabled: enabled.value };
  }

  return {
    ok: true,
    deck: {
      title: toText(root.title) || fallbackTitle,
      description: toText(root.description) || undefined,
      enabled: enabled.value,
      shuffle: optionalBool(root.shuffle, true),
      shuffleOptions: optionalBool(root.shuffleOptions, true),
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
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*\//, "").replace(/\.ya?ml$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Untitled deck";
}
