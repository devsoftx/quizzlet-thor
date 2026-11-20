// One answered card, as recorded for a parent's Progress page.
//
// Shared by the browser (which measures it) and the server (which checks and
// stores it), so this file must stay free of React and browser APIs. Only kid
// profiles' sessions send these: a guest's answers are never recorded.

import { isDifficulty, type Card, type Difficulty } from "./deck.js";

/** Longest a card's question is kept (enough to recognize it). */
export const MAX_QUESTION_CHARS = 200;
export const MAX_DECK_TITLE_CHARS = 120;
export const MAX_DECK_KEY_CHARS = 200;
/** Answers picked on one card before submitting; more are dropped from the middle. */
export const MAX_PICKS = 20;
/** Time on one card is counted up to this (a learner who walked away isn't "slow"). */
export const MAX_ANSWER_MS = 10 * 60 * 1000;
/** Most options a card can have that the keyboard shortcuts reach (A–J). */
export const MAX_OPTIONS = 10;

export interface AttemptDetail {
  /** Which deck: "bundled:<file>", "account:<id>" or "imported:<file>". */
  deckKey: string;
  deckTitle: string;
  /** The card within its deck (a fingerprint of its question and answer). */
  cardKey: string;
  /** The question, shortened, so the parent can see which card it was. */
  question: string;
  difficulty: Difficulty;
  /** How long the card was on screen before the answer was submitted, in ms (time in another tab doesn't count). */
  ms: number;
  /**
   * The answers picked, in order, by their position in the deck file (not the
   * shuffled order on screen). The last one is the answer submitted; picking
   * the same answer twice in a row counts once.
   */
  picks: number[];
  /** Position of the right answer in the deck file. */
  answerIndex: number;
  optionCount: number;
  /** Answered in a "practice the missed ones" round. */
  retry: boolean;
}

/** FNV-1a, 64 bits, as 16 hex digits: a short, stable fingerprint (not a secret). */
function fingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** A card's fingerprint: the same card in the same deck gets the same key in every round. */
export const cardKey = (card: Pick<Card, "question" | "answer">) => fingerprint(`${card.question}\u0000${card.answer}`);

export const shortQuestion = (question: string) =>
  question.length > MAX_QUESTION_CHARS ? `${question.slice(0, MAX_QUESTION_CHARS - 1)}…` : question;

/** Keeps the first picks and the last one (the one submitted) when there are too many. */
export function capPicks(picks: number[]): number[] {
  return picks.length <= MAX_PICKS ? picks : [...picks.slice(0, MAX_PICKS - 1), picks.at(-1)!];
}

const DECK_KEY = /^(bundled|imported|account):[^\p{Cc}]{1,190}$/u;
const CARD_KEY = /^[0-9a-f]{16}$/;
const isIndex = (value: unknown, below: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < below;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;

/**
 * Checks the details sent with a batch of answers: one per answer, each well
 * formed and agreeing with whether that answer was right. Returns the details,
 * or why they were refused (the answers' points are saved either way).
 */
export function parseAttemptDetails(raw: unknown, answers: readonly boolean[]): AttemptDetail[] | string {
  if (!Array.isArray(raw) || raw.length !== answers.length) return "one detail per answer";
  const out: AttemptDetail[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "not an object";
    const d = item as Record<string, unknown>;
    if (typeof d.deckKey !== "string" || d.deckKey.length > MAX_DECK_KEY_CHARS || !DECK_KEY.test(d.deckKey)) return "deckKey";
    if (!isText(d.deckTitle, MAX_DECK_TITLE_CHARS)) return "deckTitle";
    if (typeof d.cardKey !== "string" || !CARD_KEY.test(d.cardKey)) return "cardKey";
    if (!isText(d.question, MAX_QUESTION_CHARS)) return "question";
    if (!isDifficulty(d.difficulty)) return "difficulty";
    if (!Number.isInteger(d.ms) || (d.ms as number) < 0 || (d.ms as number) > MAX_ANSWER_MS) return "ms";
    if (!Number.isInteger(d.optionCount) || (d.optionCount as number) < 2 || (d.optionCount as number) > MAX_OPTIONS) return "optionCount";
    const optionCount = d.optionCount as number;
    if (!isIndex(d.answerIndex, optionCount)) return "answerIndex";
    if (!Array.isArray(d.picks) || d.picks.length < 1 || d.picks.length > MAX_PICKS || !d.picks.every((p) => isIndex(p, optionCount))) return "picks";
    const picks = d.picks;
    if (picks.some((p, j) => j > 0 && p === picks[j - 1])) return "picks repeat";
    if ((picks.at(-1) === d.answerIndex) !== answers[i]) return "picks disagree with the answer";
    if (typeof d.retry !== "boolean") return "retry";
    out.push({
      deckKey: d.deckKey,
      deckTitle: d.deckTitle,
      cardKey: d.cardKey,
      question: d.question,
      difficulty: d.difficulty,
      ms: d.ms as number,
      picks,
      answerIndex: d.answerIndex,
      optionCount,
      retry: d.retry,
    });
  }
  return out;
}

// ------------------------------------------------------- Stored and served

/** Answers are kept this long, then the daily cleanup deletes them. */
export const PROGRESS_RETENTION_DAYS = 180;
/** The periods a parent can look at. */
export const PROGRESS_PERIODS = [7, 30, 90, PROGRESS_RETENTION_DAYS] as const;
/** Most answers one Progress page loads (newest first); older ones in the period are left out. */
export const MAX_PROGRESS_ATTEMPTS = 5000;

/** An answer as stored: its details, whether it was right, and when the server got it. */
export interface StoredAttempt extends AttemptDetail {
  correct: boolean;
  answeredAt: string;
}

/** A card the Progress page shows (sent once, however often it was answered). */
export interface ProgressCard {
  deckKey: string;
  deckTitle: string;
  cardKey: string;
  question: string;
  difficulty: Difficulty;
  optionCount: number;
  answerIndex: number;
}

/** One answer on the Progress page; `card` is its card's index in `cards`. */
export interface ProgressAttempt {
  card: number;
  correct: boolean;
  ms: number;
  picks: number[];
  retry: boolean;
  answeredAt: string;
}

/** GET /api/progress: one kid's answers in a period, oldest first. */
export interface ProgressData {
  profileId: string;
  days: number;
  since: string;
  cards: ProgressCard[];
  attempts: ProgressAttempt[];
  /** True when the period held more than MAX_PROGRESS_ATTEMPTS answers (the oldest were left out). */
  truncated: boolean;
}

/**
 * Packs stored answers for the page: each card once, answers oldest first.
 * `rows` come newest first (as listAttempts returns them); answers saved in one
 * batch share a time, so they are reversed rather than sorted by time alone,
 * which keeps their order within the batch.
 */
export function packProgress(rows: StoredAttempt[]): Pick<ProgressData, "cards" | "attempts"> {
  const cards: ProgressCard[] = [];
  const index = new Map<string, number>();
  const ordered = [...rows].reverse().sort((a, b) => a.answeredAt.localeCompare(b.answeredAt)); // a stable sort: ties keep their order
  const attempts = ordered.map((row) => {
    const key = `${row.deckKey}\u0000${row.cardKey}`;
    let i = index.get(key);
    const card: ProgressCard = {
      deckKey: row.deckKey,
      deckTitle: row.deckTitle,
      cardKey: row.cardKey,
      question: row.question,
      difficulty: row.difficulty,
      optionCount: row.optionCount,
      answerIndex: row.answerIndex,
    };
    if (i === undefined) {
      i = cards.push(card) - 1;
      index.set(key, i);
    } else cards[i] = card; // the newest answer has the deck's latest wording and level
    return { card: i, correct: row.correct, ms: row.ms, picks: row.picks, retry: row.retry, answeredAt: row.answeredAt };
  });
  return { cards, attempts };
}
