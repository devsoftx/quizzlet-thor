import { describe, expect, it } from "vitest";
import { buildSession, parseDeck, titleFromFileName } from "./deck";
import { isVisible, loadBundledDecks, type DeckEntry } from "./library";
import template from "../public/deck-template.yaml?raw";

describe("deck template", () => {
  it("is a valid, enabled deck that shows every card feature", () => {
    const result = parseDeck(template, "template");
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    expect(result.deck.enabled).toBe(true);
    expect(result.deck.cards.some((c) => c.explanation)).toBe(true);
    expect(result.deck.cards.some((c) => c.shuffleOptions === false)).toBe(true);
  });
});

describe("parseDeck", () => {
  it("parses a full deck", () => {
    const result = parseDeck(
      `
title: Test
description: A deck
enabled: true
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
        enabled: true,
        shuffle: false,
        shuffleOptions: true,
        cards: [{ question: "Q1?", options: ["A", "B", "C"], answer: "B", explanation: "Because." }],
      },
    });
  });

  it("accepts numeric options; a bare list of cards parses but is disabled", () => {
    const result = parseDeck("- question: 2+2?\n  options: [3, 4]\n  answer: 4\n", "Math");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deck.title).toBe("Math");
    expect(result.deck.enabled).toBe(false);
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

describe("enabled", () => {
  const deck = (enabledLine: string) =>
    parseDeck(`title: T\n${enabledLine}\ncards:\n  - question: Q\n    options: [A, B]\n    answer: A\n`, "x");
  const enabledOf = (enabledLine: string) => {
    const r = deck(enabledLine);
    return r.ok ? r.deck.enabled : r.enabled;
  };

  it("is true only when the deck says so", () => {
    expect(enabledOf("enabled: true")).toBe(true);
    expect(enabledOf("enabled: false")).toBe(false);
    expect(enabledOf("")).toBe(false); // missing = hidden
    expect(enabledOf("enabled: enabled")).toBe(true);
    expect(enabledOf("enabled: Disabled")).toBe(false);
  });

  it("reports a value that isn't true/false", () => {
    const r = deck("enabled: maybe");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.enabled).toBeNull();
    expect(r.errors[0]).toContain('"enabled" must be true or false');
  });

  it("shows enabled decks, and broken decks unless they're disabled", () => {
    const entry = (yaml: string): DeckEntry => ({
      id: "x",
      fileName: "x.yaml",
      source: "bundled",
      ...parseDeck(yaml, "x"),
    });
    const card = "cards:\n  - question: Q\n    options: [A, B]\n    answer: A\n";
    const broken = "cards:\n  - question: Q\n    options: [A, B]\n    answer: C\n";
    expect(isVisible(entry(`enabled: true\n${card}`))).toBe(true);
    expect(isVisible(entry(`enabled: false\n${card}`))).toBe(false);
    expect(isVisible(entry(card))).toBe(false);
    expect(isVisible(entry(`enabled: true\n${broken}`))).toBe(true); // show the errors
    expect(isVisible(entry(`enabled: false\n${broken}`))).toBe(false);
    expect(isVisible(entry(`enabled: maybe\n${card}`))).toBe(true); // typo: show it
    expect(isVisible(entry("cards: [unclosed"))).toBe(true); // broken YAML: show it
  });
});

describe("buildSession", () => {
  const deck = {
    title: "T",
    enabled: true,
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
