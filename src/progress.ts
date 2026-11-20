// The numbers behind a parent's Progress page, worked out from one kid's
// answers (GET /api/progress). Pure functions, so every chart and table on
// the page agrees and each rule is unit-tested.

import type { ProgressAttempt, ProgressCard, ProgressData } from "./attempts";
import { DIFFICULTIES, type Difficulty } from "./deck";

/** One answer with its card. */
export interface Answer extends ProgressAttempt {
  info: ProgressCard;
  /** Different answers tried before submitting (1 = went straight for it). */
  tried: number;
  /** The first answer picked was the right one. */
  firstPickRight: boolean;
}

/** Answers given within this many seconds count as quick on the learning profile. */
export const QUICK_SECONDS = 20;

/** Time-per-card bins, in seconds: [from, to). The last one is open-ended. */
export const TIME_BINS: ReadonlyArray<readonly [number, number]> = [
  [0, 5],
  [5, 10],
  [10, 20],
  [20, 40],
  [40, 60],
  [60, Infinity],
];

/** Columns of the answer-changes heat map: answers tried before submitting (the last means "4 or more"). */
export const TRIED_COLUMNS = [1, 2, 3, 4] as const;

export const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The answers, oldest first, each with its card; only those in `deckKey` when given. */
export function answersOf(data: Pick<ProgressData, "cards" | "attempts">, deckKey = ""): Answer[] {
  return data.attempts
    .map((a) => {
      const info = data.cards[a.card];
      return { ...a, info, tried: new Set(a.picks).size, firstPickRight: a.picks[0] === info?.answerIndex };
    })
    .filter((a) => a.info && (!deckKey || a.info.deckKey === deckKey))
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
}

/** The decks answered in, most answered first (for the deck filter and the Pareto chart). */
export function decksOf(data: Pick<ProgressData, "cards" | "attempts">): Array<{ deckKey: string; title: string; answered: number }> {
  const counts = new Map<string, { deckKey: string; title: string; answered: number }>();
  for (const a of data.attempts) {
    const card = data.cards[a.card];
    if (!card) continue;
    const entry = counts.get(card.deckKey) ?? { deckKey: card.deckKey, title: card.deckTitle, answered: 0 };
    entry.title = card.deckTitle; // the newest title
    entry.answered++;
    counts.set(card.deckKey, entry);
  }
  return [...counts.values()].sort((a, b) => b.answered - a.answered || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------ Right / wrong

export interface Tally {
  answered: number;
  right: number;
  wrong: number;
}

export function tally(answers: Answer[]): Tally {
  const right = answers.filter((a) => a.correct).length;
  return { answered: answers.length, right, wrong: answers.length - right };
}

export function byDifficulty<T>(answers: Answer[], measure: (group: Answer[], level: Difficulty) => T): Record<Difficulty, T> {
  return Object.fromEntries(DIFFICULTIES.map((level) => [level, measure(answers.filter((a) => a.info.difficulty === level), level)])) as Record<Difficulty, T>;
}

// ------------------------------------------------------------------ Retries

/** One card's answers in the period, oldest first. */
export interface CardHistory {
  info: ProgressCard;
  answers: Answer[];
}

export function cardHistories(answers: Answer[]): CardHistory[] {
  const cards = new Map<string, CardHistory>();
  for (const a of answers) {
    const key = `${a.info.deckKey}\u0000${a.info.cardKey}`;
    const history = cards.get(key) ?? { info: a.info, answers: [] };
    history.info = a.info;
    history.answers.push(a);
    cards.set(key, history);
  }
  return [...cards.values()];
}

/** A card answered wrong at least once: how many more tries it took to get it right. */
export interface MissedCard {
  info: ProgressCard;
  /** Answers after the first miss, up to and including the first right one (all of them if never right). */
  retries: number;
  /** Got it right after the miss. */
  fixed: boolean;
  /** Wrong answers in all. */
  misses: number;
}

export function missedCards(histories: CardHistory[]): MissedCard[] {
  const out: MissedCard[] = [];
  for (const { info, answers } of histories) {
    const firstMiss = answers.findIndex((a) => !a.correct);
    if (firstMiss < 0) continue;
    const after = answers.slice(firstMiss + 1);
    const fixAt = after.findIndex((a) => a.correct);
    out.push({
      info,
      retries: fixAt < 0 ? after.length : fixAt + 1,
      fixed: fixAt >= 0,
      misses: answers.filter((a) => !a.correct).length,
    });
  }
  return out;
}

export interface RetrySummary {
  /** Cards answered wrong at least once. */
  missed: number;
  fixed: number;
  /** Answers given to missed cards after their first miss. */
  retries: number;
  /** Average retries a fixed card needed (null when none was fixed). */
  averageToFix: number | null;
  /** Fixed on the 1st, 2nd and 3rd-or-later retry; not right yet (retried or not). */
  buckets: { first: number; second: number; thirdPlus: number; notYet: number };
}

export function retrySummary(missed: MissedCard[]): RetrySummary {
  const fixed = missed.filter((m) => m.fixed);
  return {
    missed: missed.length,
    fixed: fixed.length,
    retries: missed.reduce((sum, m) => sum + m.retries, 0),
    averageToFix: ratio(fixed.reduce((sum, m) => sum + m.retries, 0), fixed.length),
    buckets: {
      first: fixed.filter((m) => m.retries === 1).length,
      second: fixed.filter((m) => m.retries === 2).length,
      thirdPlus: fixed.filter((m) => m.retries >= 3).length,
      notYet: missed.length - fixed.length,
    },
  };
}

// -------------------------------------------------------------------- Time

export interface TimeSummary {
  /** Average seconds per card (null with no answers). */
  averageSeconds: number | null;
  medianSeconds: number | null;
  /** Answers per TIME_BINS bin, right and wrong. */
  bins: Array<{ from: number; to: number; right: number; wrong: number }>;
}

export function timeSummary(answers: Answer[]): TimeSummary {
  const seconds = answers.map((a) => a.ms / 1000);
  return {
    averageSeconds: ratio(seconds.reduce((sum, s) => sum + s, 0), seconds.length),
    medianSeconds: median(seconds),
    bins: TIME_BINS.map(([from, to]) => {
      const inBin = answers.filter((a) => a.ms / 1000 >= from && a.ms / 1000 < to);
      const right = inBin.filter((a) => a.correct).length;
      return { from, to, right, wrong: inBin.length - right };
    }),
  };
}

/** Median seconds for right and for wrong answers. */
export const medianSeconds = (answers: Answer[]) => ({
  right: median(answers.filter((a) => a.correct).map((a) => a.ms / 1000)),
  wrong: median(answers.filter((a) => !a.correct).map((a) => a.ms / 1000)),
});

// ---------------------------------------------------------- Answer changes

export interface ChangeSummary {
  /** Answers where more than one option was tried before submitting. */
  changed: number;
  /** Changed away from the right answer to a wrong one. */
  rightToWrong: number;
  /** Changed from a wrong answer to the right one. */
  wrongToRight: number;
}

export function changeSummary(answers: Answer[]): ChangeSummary {
  const changed = answers.filter((a) => a.tried > 1);
  return {
    changed: changed.length,
    rightToWrong: changed.filter((a) => a.firstPickRight && !a.correct).length,
    wrongToRight: changed.filter((a) => !a.firstPickRight && a.correct).length,
  };
}

/** Heat map cells: for each difficulty, how many answers tried 1, 2, 3 or 4+ options. */
export function changeHeatmap(answers: Answer[]): Record<Difficulty, { total: number; counts: number[] }> {
  return byDifficulty(answers, (group) => ({
    total: group.length,
    counts: TRIED_COLUMNS.map((n, i) => group.filter((a) => (i === TRIED_COLUMNS.length - 1 ? a.tried >= n : a.tried === n)).length),
  }));
}

/** Cards where the learner changed their mind the most (most extra picks first). */
export function mostChanged(histories: CardHistory[], limit = 5) {
  return histories
    .map(({ info, answers }) => ({
      info,
      changes: answers.reduce((sum, a) => sum + a.picks.length - 1, 0),
      answered: answers.length,
      rightToWrong: answers.filter((a) => a.tried > 1 && a.firstPickRight && !a.correct).length,
      lastRight: answers.at(-1)?.correct ?? false,
    }))
    .filter((c) => c.changes > 0)
    .sort((a, b) => b.changes - a.changes || b.rightToWrong - a.rightToWrong || a.info.question.localeCompare(b.info.question))
    .slice(0, limit);
}

// -------------------------------------------------------- Learning profile

export const PROFILE_AXES = ["accuracy", "firstTry", "sure", "quick", "recovery"] as const;
export type ProfileAxis = (typeof PROFILE_AXES)[number];

/**
 * The spider chart: five shares from 0 to 1 for one group of answers.
 *  - accuracy: answers that were right
 *  - firstTry: cards right the first time they came up in the period
 *  - sure: answers where only one option was tried
 *  - quick: answers given within QUICK_SECONDS
 *  - recovery: missed cards later answered right (null when nothing was missed)
 */
export function learningProfile(answers: Answer[]): Record<ProfileAxis, number | null> {
  const histories = cardHistories(answers);
  const missed = missedCards(histories);
  return {
    accuracy: ratio(answers.filter((a) => a.correct).length, answers.length),
    firstTry: ratio(histories.filter((h) => h.answers[0].correct).length, histories.length),
    sure: ratio(answers.filter((a) => a.tried === 1).length, answers.length),
    quick: ratio(answers.filter((a) => a.ms <= QUICK_SECONDS * 1000).length, answers.length),
    recovery: ratio(missed.filter((m) => m.fixed).length, missed.length),
  };
}

// ------------------------------------------------------------------ Pareto

export interface ParetoBar {
  key: string;
  label: string;
  wrong: number;
  /** This bar's part of all wrong answers, 0–1. */
  share: number;
  /** Running total of `share`, left to right. */
  cumulative: number;
}

/**
 * Wrong answers per group, biggest first, with each group's share and the
 * running total: the few groups behind most mistakes come first. Groups past
 * `maxBars` fold into one last bar (`otherLabel`). Groups without mistakes are
 * left out, unless `keepEmpty` (the three difficulty levels are always shown).
 */
export function pareto(groups: Array<{ key: string; label: string; wrong: number }>, maxBars = 8, otherLabel = "Other", keepEmpty = false): ParetoBar[] {
  const total = groups.reduce((sum, g) => sum + g.wrong, 0);
  if (total === 0) return [];
  let sorted = groups.filter((g) => keepEmpty || g.wrong > 0).sort((a, b) => b.wrong - a.wrong);
  if (sorted.length > maxBars) {
    const rest = sorted.slice(maxBars - 1);
    sorted = [...sorted.slice(0, maxBars - 1), { key: "__other__", label: otherLabel, wrong: rest.reduce((sum, g) => sum + g.wrong, 0) }];
  }
  let running = 0;
  return sorted.map((g) => {
    running += g.wrong;
    return { ...g, share: g.wrong / total, cumulative: running / total };
  });
}
