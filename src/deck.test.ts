import { describe, expect, it } from "vitest";
import { buildSession, parseDeck, titleFromFileName } from "./deck";
import { loadBundledDecks } from "./library";

describe("parseDeck", () => {
  it("parses a full deck", () => {
    const result = parseDeck(
      `
title: Test
description: A deck
shuffle: false
cards:
  - question: Q1?
    options: [A, B, C]
    answer: B
    explanation: Because.
`,
      "fallback",
    );
    expect(result).toEqual({
      ok: true,
      deck: {
        title: "Test",
        description: "A deck",
        shuffle: false,
        shuffleOptions: true,
        cards: [{ question: "Q1?", options: ["A", "B", "C"], answer: "B", explanation: "Because." }],
      },
    });
  });

  it("accepts a bare list of cards and numeric options", () => {
    const result = parseDeck("- question: 2+2?\n  options: [3, 4]\n  answer: 4\n", "Math");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.title).toBe("Math");
    expect(result.deck.cards[0]).toEqual({ question: "2+2?", options: ["3", "4"], answer: "4" });
  });

  it("matches the answer case-insensitively but keeps the option's text", () => {
    const result = parseDeck("cards:\n  - question: Q\n    options: [Odin, Loki]\n    answer: odin\n", "x");
    expect(result.ok && result.deck.cards[0].answer).toBe("Odin");
  });

  it("reports every broken card", () => {
    const result = parseDeck(
      `
cards:
  - question: No answer
    options: [A, B]
  - question: Wrong answer
    options: [A, B]
    answer: C
  - question: Too few options
    options: [A]
    answer: A
`,
      "x",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
    expect(result.errors[1]).toContain('answer "C" is not one of the options');
  });

  it("reports invalid YAML and missing cards", () => {
    expect(parseDeck("cards: [unclosed", "x").ok).toBe(false);
    expect(parseDeck("title: Nothing here", "x").ok).toBe(false);
    expect(parseDeck("cards: []", "x").ok).toBe(false);
  });
});

describe("buildSession", () => {
  const deck = {
    title: "T",
    shuffle: true,
    shuffleOptions: true,
    cards: [
      { question: "1", options: ["a", "b", "c"], answer: "a" },
      { question: "2", options: ["a", "b", "c"], answer: "b", shuffleOptions: false },
    ],
  };

  it("keeps every card and option, honoring per-card shuffleOptions", () => {
    const session = buildSession(deck, deck.cards, () => 0);
    expect(session.map((c) => c.question).sort()).toEqual(["1", "2"]);
    const fixed = session.find((c) => c.question === "2")!;
    expect(fixed.options).toEqual(["a", "b", "c"]);
    const shuffledCard = session.find((c) => c.question === "1")!;
    expect([...shuffledCard.options].sort()).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the deck", () => {
    buildSession(deck);
    expect(deck.cards[0].options).toEqual(["a", "b", "c"]);
  });
});

describe("bundled decks in /decks", () => {
  const decks = loadBundledDecks();

  it("finds at least one deck", () => {
    expect(decks.length).toBeGreaterThan(0);
  });

  for (const entry of decks) {
    it(`${entry.fileName} is valid`, () => {
      expect(entry.ok ? [] : entry.errors).toEqual([]);
    });
  }
});

describe("titleFromFileName", () => {
  it("humanizes file names", () => {
    expect(titleFromFileName("norse-mythology.yaml")).toBe("Norse mythology");
    expect(titleFromFileName("decks/quick_math.yml")).toBe("Quick math");
  });
});
