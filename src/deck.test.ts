import { describe, expect, it } from "vitest";
import { buildSession, cardDifficulty, parseDeck, titleFromFileName } from "./deck";
import { deckMessagesEs } from "./deck-messages";
import { deckProblems, filterDecks, isVisible, loadAllBundledDecks, loadBundledDecks, type DeckEntry } from "./library";
import template from "../public/deck-template.yaml?raw";
import templateEs from "../public/deck-template.es.yaml?raw";

describe("deck template", () => {
  it("is a valid, enabled deck that shows every card feature", () => {
    const result = parseDeck(template, "template");
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (!result.ok) return;
    expect(result.deck.enabled).toBe(true);
    expect(result.deck.cards.some((c) => c.explanation)).toBe(true);
    expect(result.deck.cards.some((c) => c.shuffleOptions === false)).toBe(true);
    expect(result.deck.difficulty).toBe("medium");
    expect(result.deck.cards.some((c) => c.difficulty === "easy")).toBe(true);
  });

  it("has a Spanish version that is the same kind of deck, in Spanish", () => {
    const english = parseDeck(template, "template");
    const spanish = parseDeck(templateEs, "plantilla", deckMessagesEs);
    expect(spanish.ok ? [] : spanish.errors).toEqual([]);
    if (!english.ok || !spanish.ok) return;
    expect(english.deck.language).toBe("en");
    expect(spanish.deck.language).toBe("es");
    expect(spanish.deck.enabled).toBe(true);
    expect(spanish.deck.cards.map((c) => c.options.length)).toEqual(english.deck.cards.map((c) => c.options.length));
    expect(spanish.deck.cards.some((c) => c.explanation)).toBe(true);
    expect(spanish.deck.cards.some((c) => c.shuffleOptions === false)).toBe(true);
    expect(spanish.deck.cards.map((c) => c.difficulty)).toEqual(english.deck.cards.map((c) => c.difficulty));
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
  // Originals and their translations (decks/es/…).
  const decks = loadAllBundledDecks();

  it("finds at least one deck", () => {
    expect(decks.length).toBeGreaterThan(0);
  });

  for (const entry of decks) {
    it(`${entry.fileName} is valid`, () => {
      expect(entry.ok ? [] : entry.errors).toEqual([]);
    });
  }
});

describe("Spanish translations in /decks/es", () => {
  const all = loadAllBundledDecks();
  const originals = new Map(all.filter((d) => !d.fileName.includes("/")).map((d) => [d.fileName, d]));
  const translations = all.filter((d) => d.fileName.startsWith("es/"));

  it("translates every deck", () => {
    const missing = [...originals.keys()].filter((name) => !translations.some((t) => t.fileName === `es/${name}`));
    expect(missing).toEqual([]);
  });

  for (const entry of translations) {
    it(`${entry.fileName} matches its original card for card`, () => {
      const original = originals.get(entry.fileName.slice("es/".length));
      expect(original, "a translation needs an original with the same file name").toBeDefined();
      if (!entry.ok || !original?.ok) return; // reported by the validity test above
      const [es, en] = [entry.deck, original.deck];
      expect(es.language).toBe("es");
      expect({ enabled: es.enabled, shuffle: es.shuffle, shuffleOptions: es.shuffleOptions }).toEqual({
        enabled: en.enabled,
        shuffle: en.shuffle,
        shuffleOptions: en.shuffleOptions,
      });
      expect(es.cards).toHaveLength(en.cards.length);
      es.cards.forEach((card, i) => {
        const source = en.cards[i];
        const where = `card ${i + 1}`;
        expect(card.options, where).toHaveLength(source.options.length);
        // The right answer sits in the same place, so a translation can't change which option is correct.
        expect(card.options.indexOf(card.answer), where).toBe(source.options.indexOf(source.answer));
        expect(Boolean(card.explanation), where).toBe(Boolean(source.explanation));
        expect(card.shuffleOptions, where).toBe(source.shuffleOptions);
        expect(card.difficulty, where).toBe(source.difficulty); // the Progress page groups a card the same in either language
        expect(card.question, where).not.toBe(source.question);
      });
    });
  }

  it("shows each deck in Spanish when the app is in Spanish, and as written in English", () => {
    const english = loadBundledDecks();
    const spanish = loadBundledDecks(undefined, "es");
    expect(spanish.map((d) => d.id.replace("bundled:es/", "bundled:")).sort()).toEqual(english.map((d) => d.id).sort());
    for (const d of spanish) if (d.ok) expect(d.deck.language, d.fileName).toBe("es");
    for (const d of english) if (d.ok) expect(d.deck.language, d.fileName).toBe("en");
  });
});

describe("titleFromFileName", () => {
  it("humanizes file names", () => {
    expect(titleFromFileName("norse-mythology.yaml")).toBe("Norse mythology");
    expect(titleFromFileName("decks/quick_math.yml")).toBe("Quick math");
  });
});

describe("subject metadata", () => {
  const source = (line: string) => `title: Stars\n${line}\nenabled: true\ncards:\n  - question: Q\n    options: [A, B]\n    answer: A\n`;
  it("keeps an explicit subject and accepts an older deck without one", () => {
    const tagged = parseDeck(source("subject: Space science"), "x");
    const legacy = parseDeck(source(""), "x");
    expect(tagged.ok && tagged.deck.subject).toBe("Space science");
    expect(legacy.ok && legacy.deck.subject).toBeUndefined();
  });
  it("rejects invalid subject metadata and duplicate choices", () => {
    expect(parseDeck(source("subject: [a, b]"), "x").ok).toBe(false);
    expect(parseDeck(source("").replace("[A, B]", "[A, A]"), "x").ok).toBe(false);
  });
});

describe("deck language", () => {
  const source = (line: string) => `title: Estrellas\n${line}\nenabled: true\ncards:\n  - question: ¿Sol?\n    options: [Sí, No]\n    answer: Sí\n`;

  it("keeps the language a deck is written in, tidied to its standard form", () => {
    const tagged = (line: string) => {
      const r = parseDeck(source(line), "x");
      return r.ok ? r.deck.language : r.errors;
    };
    expect(tagged("language: es")).toBe("es");
    expect(tagged("language: ES-mx")).toBe("es-MX");
    expect(tagged("")).toBeUndefined();
  });

  it("rejects something that isn't a language code", () => {
    const result = parseDeck(source("language: Spanish please"), "x");
    expect(result.ok ? [] : result.errors).toEqual(['"language" must be a language code such as en or es (got "Spanish please").']);
    expect(parseDeck(source("language: [es]"), "x").ok).toBe(false);
  });

  it("marks the bundled decks as English unless they say otherwise", () => {
    const bundled = loadBundledDecks().filter((d) => d.ok);
    expect(bundled.length).toBeGreaterThan(0);
    for (const d of bundled) if (d.ok) expect(d.deck.language).toBe("en");
  });

  it("filters decks by language", () => {
    const entry = (id: string, language?: string): DeckEntry => ({
      id, fileName: `${id}.yaml`, source: "imported", ok: true,
      deck: { title: id, enabled: true, shuffle: false, shuffleOptions: false, cards: [], ...(language ? { language } : {}) },
    });
    const decks = [entry("a", "es"), entry("b", "es-MX"), entry("c", "en"), entry("d")];
    expect(filterDecks(decks, "", "", "es").map((d) => d.id)).toEqual(["a", "b"]);
    expect(filterDecks(decks, "", "", "en").map((d) => d.id)).toEqual(["c"]);
    expect(filterDecks(decks, "", "").map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("deck problems in Spanish", () => {
  it("describes every problem in the learner's language", () => {
    const result = parseDeck(
      "title: Mal\nenabled: quizás\nsubject: ''\ncards:\n  - 3\n  - options: [A, B]\n  - question: ¿Uno?\n    options: [A]\n  - question: ¿Dos?\n    options: [A, A]\n  - question: ¿Tres?\n    options: [A, B]\n  - question: ¿Cuatro?\n    options: [A, B]\n    answer: C\n",
      "x",
      deckMessagesEs,
    );
    expect(result.ok ? [] : result.errors).toEqual([
      '"enabled" debe ser true o false (se encontró "quizás").',
      '"subject" debe ser un texto no vacío de 80 caracteres como máximo.',
      "Tarjeta 1: se esperaba un bloque con question, options y answer.",
      'Tarjeta 2: falta "question".',
      'Tarjeta 3 ("¿Uno?"): "options" debe ser una lista con al menos 2 elementos.',
      'Tarjeta 4 ("¿Dos?"): la opción "A" aparece dos veces.',
      'Tarjeta 5 ("¿Tres?"): falta "answer".',
      'Tarjeta 6 ("¿Cuatro?"): la respuesta "C" no es una de las opciones.',
    ]);
    expect(parseDeck("a: [", "x", deckMessagesEs)).toMatchObject({ ok: false, errors: [expect.stringMatching(/^El YAML no es válido: /)] });
    expect(titleFromFileName(".yaml", deckMessagesEs)).toBe("Mazo sin título");
  });

  it("re-reads a deck the server refused, to list its problems in Spanish", () => {
    const yaml = "enabled: true\ncards: []\n";
    expect(deckProblems("x.yaml", yaml, ['"cards" is empty — add at least one card.'], deckMessagesEs)).toEqual([
      '"cards" está vacía: agrega al menos una tarjeta.',
    ]);
    // Nothing wrong here, so the server checked something else: keep its words.
    const fine = "enabled: true\ncards:\n  - question: Q\n    options: [A, B]\n    answer: A\n";
    expect(deckProblems("x.yaml", fine, ["Too big."], deckMessagesEs)).toEqual(["Too big."]);
  });
});

describe("difficulty", () => {
  const deck = (head: string, card = "") =>
    parseDeck(`${head}\nenabled: true\ncards:\n  - question: Q1?\n    options: [A, B]\n    answer: A\n${card}  - question: Q2?\n    options: [A, B]\n    answer: B\n`, "x");

  it("takes a card's own level, else the deck's, else medium", () => {
    const own = deck("difficulty: hard", "    difficulty: Easy\n");
    expect(own.ok).toBe(true);
    if (!own.ok) return;
    expect(own.deck.difficulty).toBe("hard");
    expect(own.deck.cards.map((c) => cardDifficulty(c, own.deck))).toEqual(["easy", "hard"]);

    const none = deck("title: Plain");
    if (!none.ok) throw new Error("expected a deck");
    expect(none.deck).not.toHaveProperty("difficulty");
    expect(none.deck.cards[0]).not.toHaveProperty("difficulty");
    expect(none.deck.cards.map((c) => cardDifficulty(c, none.deck))).toEqual(["medium", "medium"]);
  });

  it("rejects a level that isn't easy, medium or hard, on the deck or a card", () => {
    expect(deck("difficulty: tricky")).toMatchObject({ ok: false, errors: ['"difficulty" must be easy, medium or hard (got "tricky").'] });
    expect(deck("title: T", "    difficulty: 3\n")).toMatchObject({
      ok: false,
      errors: ['Card 1 ("Q1?"): "difficulty" must be easy, medium or hard (got "3").'],
    });
    expect(parseDeck("difficulty: dura\nenabled: true\ncards:\n  - question: Q\n    options: [A, B]\n    answer: A\n", "x", deckMessagesEs)).toMatchObject({
      ok: false,
      errors: ['"difficulty" debe ser easy, medium o hard (se encontró "dura").'],
    });
  });

  it("labels every card of the bundled decks and their translations", () => {
    for (const entry of loadAllBundledDecks()) {
      if (!entry.ok) continue;
      const unlabeled = entry.deck.cards.filter((c) => !c.difficulty && !entry.deck.difficulty).map((c) => c.question.slice(0, 40));
      expect(unlabeled, entry.fileName).toEqual([]);
    }
  });
});
