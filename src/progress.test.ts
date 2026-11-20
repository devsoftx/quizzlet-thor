import { describe, expect, it } from "vitest";
import { packProgress, type StoredAttempt } from "./attempts";
import type { Difficulty } from "./deck";
import {
  answersOf,
  byDifficulty,
  cardHistories,
  changeHeatmap,
  changeSummary,
  decksOf,
  learningProfile,
  missedCards,
  mostChanged,
  pareto,
  retrySummary,
  tally,
  timeSummary,
} from "./progress";

let clock = Date.parse("2026-11-01T10:00:00Z");

/** An answer to card `q` (answer at position 0): `picks` by position, right when the last pick is 0. */
function row(q: string, picks: number[], opts: { ms?: number; difficulty?: Difficulty; deck?: string; retry?: boolean } = {}): StoredAttempt {
  clock += 60_000;
  return {
    deckKey: opts.deck ?? "bundled:planets.yaml",
    deckTitle: opts.deck === "bundled:moons.yaml" ? "Moons" : "Planets",
    cardKey: q.padEnd(16, "0").slice(0, 16).replace(/[^0-9a-f]/g, "a"),
    question: `Question ${q}?`,
    difficulty: opts.difficulty ?? "medium",
    ms: opts.ms ?? 8_000,
    picks,
    answerIndex: 0,
    optionCount: 4,
    retry: opts.retry ?? false,
    correct: picks.at(-1) === 0,
    answeredAt: new Date(clock).toISOString(),
  };
}

const data = (rows: StoredAttempt[]) => packProgress(rows);

describe("packProgress", () => {
  it("sends each card once and the answers oldest first", () => {
    const rows = [row("a", [0]), row("b", [1]), row("a", [2, 0])];
    const packed = packProgress([...rows].reverse()); // the database returns newest first
    expect(packed.cards.map((c) => c.question)).toEqual(["Question a?", "Question b?"]);
    expect(packed.attempts.map((a) => [a.card, a.correct, a.picks])).toEqual([
      [0, true, [0]],
      [1, false, [1]],
      [0, true, [2, 0]],
    ]);
  });

  it("keeps the order of answers saved together in one batch (they share a time)", () => {
    const batch = [row("a", [1]), row("a", [2]), row("a", [0])].map((r) => ({ ...r, answeredAt: "2026-11-02T09:00:00.000Z" }));
    const packed = packProgress([...batch].reverse()); // newest first, as stored
    expect(packed.attempts.map((a) => a.picks)).toEqual([[1], [2], [0]]);
    expect(retrySummary(missedCards(cardHistories(answersOf(packed))))).toMatchObject({ fixed: 1, retries: 2 });
  });
});

describe("progress numbers", () => {
  const rows = [
    row("a", [0], { difficulty: "easy", ms: 3_000 }),
    row("b", [1], { difficulty: "hard", ms: 25_000 }), // b: wrong…
    row("c", [0, 2], { difficulty: "medium", ms: 12_000 }), // c: right first, changed to wrong
    row("b", [1], { difficulty: "hard", retry: true }), // …wrong again…
    row("b", [2, 0], { difficulty: "hard", retry: true }), // …right on the 2nd retry, after changing
    row("c", [3, 1, 0], { difficulty: "medium", retry: true, ms: 70_000 }), // c: right on the 1st retry
    row("d", [1], { difficulty: "easy", deck: "bundled:moons.yaml" }), // d: wrong, never retried
  ];
  const answers = answersOf(data(rows));

  it("counts right and wrong, overall and by difficulty", () => {
    expect(tally(answers)).toEqual({ answered: 7, right: 3, wrong: 4 });
    expect(byDifficulty(answers, tally)).toEqual({
      easy: { answered: 2, right: 1, wrong: 1 },
      medium: { answered: 2, right: 1, wrong: 1 },
      hard: { answered: 3, right: 1, wrong: 2 },
    });
  });

  it("counts the retries a missed card needed", () => {
    const missed = missedCards(cardHistories(answers));
    expect(missed.map((m) => [m.info.question, m.retries, m.fixed, m.misses])).toEqual([
      ["Question b?", 2, true, 2],
      ["Question c?", 1, true, 1],
      ["Question d?", 0, false, 1],
    ]);
    expect(retrySummary(missed)).toEqual({
      missed: 3,
      fixed: 2,
      retries: 3,
      averageToFix: 1.5,
      buckets: { first: 1, second: 1, thirdPlus: 0, notYet: 1 },
    });
  });

  it("bins the time per card and keeps right and wrong apart", () => {
    const time = timeSummary(answers);
    expect(time.averageSeconds).toBeCloseTo((3 + 25 + 12 + 8 + 8 + 70 + 8) / 7);
    expect(time.medianSeconds).toBe(8);
    expect(time.bins.map((b) => [b.from, b.right, b.wrong])).toEqual([
      [0, 1, 0],
      [5, 1, 2],
      [10, 0, 1],
      [20, 0, 1],
      [40, 0, 0],
      [60, 1, 0],
    ]);
  });

  it("finds answers changed before submitting, and which way they went", () => {
    expect(changeSummary(answers)).toEqual({ changed: 3, rightToWrong: 1, wrongToRight: 2 });
    expect(changeHeatmap(answers)).toEqual({
      easy: { total: 2, counts: [2, 0, 0, 0] },
      medium: { total: 2, counts: [0, 1, 1, 0] },
      hard: { total: 3, counts: [2, 1, 0, 0] },
    });
    expect(mostChanged(cardHistories(answers)).map((c) => [c.info.question, c.changes, c.rightToWrong, c.lastRight])).toEqual([
      ["Question c?", 3, 1, true],
      ["Question b?", 1, 0, true],
    ]);
  });

  it("scores the learning profile from 0 to 1 on each axis", () => {
    expect(learningProfile(answers)).toEqual({
      accuracy: 3 / 7,
      firstTry: 1 / 4, // a, b, c, d: only a was right the first time
      sure: 4 / 7,
      quick: 5 / 7, // 25 s and 70 s are slow
      recovery: 2 / 3,
    });
    // Nothing missed: no recovery to measure.
    expect(learningProfile(answersOf(data([row("x", [0])]))).recovery).toBeNull();
    expect(learningProfile([])).toEqual({ accuracy: null, firstTry: null, sure: null, quick: null, recovery: null });
  });

  it("lists the decks and filters answers by deck", () => {
    expect(decksOf(data(rows))).toEqual([
      { deckKey: "bundled:planets.yaml", title: "Planets", answered: 6 },
      { deckKey: "bundled:moons.yaml", title: "Moons", answered: 1 },
    ]);
    expect(answersOf(data(rows), "bundled:moons.yaml").map((a) => a.info.question)).toEqual(["Question d?"]);
  });
});

describe("pareto", () => {
  it("puts the biggest share of mistakes first, with a running total", () => {
    const bars = pareto([
      { key: "easy", label: "Easy", wrong: 2 },
      { key: "hard", label: "Hard", wrong: 6 },
      { key: "medium", label: "Medium", wrong: 0 },
      { key: "x", label: "X", wrong: 2 },
    ]);
    expect(bars.map((b) => [b.key, b.wrong, b.share, b.cumulative])).toEqual([
      ["hard", 6, 0.6, 0.6],
      ["easy", 2, 0.2, 0.8],
      ["x", 2, 0.2, 1],
    ]);
    expect(pareto([{ key: "a", label: "A", wrong: 0 }])).toEqual([]);
    // The difficulty levels keep a level without mistakes, last.
    const levels = pareto([{ key: "easy", label: "Easy", wrong: 0 }, { key: "medium", label: "Medium", wrong: 1 }, { key: "hard", label: "Hard", wrong: 3 }], 8, "Other", true);
    expect(levels.map((b) => [b.key, b.share, b.cumulative])).toEqual([["hard", 0.75, 0.75], ["medium", 0.25, 1], ["easy", 0, 1]]);
  });

  it("folds the smallest groups into one last bar", () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ key: `d${i}`, label: `Deck ${i}`, wrong: 10 - i }));
    const bars = pareto(groups, 4, "Other decks");
    expect(bars.map((b) => [b.label, b.wrong])).toEqual([
      ["Deck 0", 10],
      ["Deck 1", 9],
      ["Deck 2", 8],
      ["Other decks", 28],
    ]);
    expect(bars.at(-1)!.cumulative).toBe(1);
  });
});
