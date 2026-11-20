import { describe, expect, it } from "vitest";
import { capPicks, cardKey, MAX_PICKS, parseAttemptDetails, shortQuestion, type AttemptDetail } from "./attempts";

const detail = (patch: Partial<AttemptDetail> = {}): AttemptDetail => ({
  deckKey: "bundled:planets.yaml",
  deckTitle: "Planets",
  cardKey: cardKey({ question: "Closest to the Sun?", answer: "Mercury" }),
  question: "Closest to the Sun?",
  difficulty: "easy",
  ms: 4200,
  picks: [2, 0],
  answerIndex: 0,
  optionCount: 4,
  retry: false,
  ...patch,
});

describe("cardKey", () => {
  it("is the same for the same card, whatever the round, and differs between cards", () => {
    const key = cardKey({ question: "Closest to the Sun?", answer: "Mercury" });
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(cardKey({ question: "Closest to the Sun?", answer: "Mercury" })).toBe(key);
    expect(cardKey({ question: "Closest to the Sun?", answer: "Venus" })).not.toBe(key);
    expect(cardKey({ question: "¿El más cercano al Sol?", answer: "Mercurio" })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("shortening", () => {
  it("keeps short questions and cuts long ones to 200 characters", () => {
    expect(shortQuestion("Short?")).toBe("Short?");
    const long = shortQuestion("x".repeat(500));
    expect(long).toHaveLength(200);
    expect(long.endsWith("…")).toBe(true);
  });

  it("keeps the first picks and the one submitted", () => {
    const picks = Array.from({ length: 30 }, (_, i) => i % 2);
    const capped = capPicks([...picks, 3]);
    expect(capped).toHaveLength(MAX_PICKS);
    expect(capped.at(-1)).toBe(3);
    expect(capPicks([1, 0])).toEqual([1, 0]);
  });
});

describe("parseAttemptDetails", () => {
  it("accepts one well-formed detail per answer", () => {
    const right = detail();
    const wrong = detail({ picks: [1], retry: true, difficulty: "hard" });
    expect(parseAttemptDetails([right, wrong], [true, false])).toEqual([right, wrong]);
  });

  it("drops fields it doesn't know", () => {
    expect(parseAttemptDetails([{ ...detail(), nickname: "Nova" }], [true])).toEqual([detail()]);
  });

  it.each([
    ["a different count", [detail(), detail()], [true]],
    ["not a list", "nope", [true]],
    ["a deck key without a source", [detail({ deckKey: "planets.yaml" })], [true]],
    ["an empty deck title", [detail({ deckTitle: " " })], [true]],
    ["a card key that isn't a fingerprint", [detail({ cardKey: "ZZZ" })], [true]],
    ["a question that is too long", [detail({ question: "x".repeat(201) })], [true]],
    ["an unknown difficulty", [detail({ difficulty: "tricky" as never })], [true]],
    ["a negative time", [detail({ ms: -1 })], [true]],
    ["a time over ten minutes", [detail({ ms: 600_001 })], [true]],
    ["no picks", [detail({ picks: [] })], [true]],
    ["a pick that isn't an option", [detail({ picks: [4, 0] })], [true]],
    ["the same pick twice in a row", [detail({ picks: [1, 1, 0] })], [true]],
    ["a last pick that disagrees with the answer", [detail({ picks: [0] })], [false]],
    ["too many options", [detail({ optionCount: 11 })], [true]],
    ["a retry flag that isn't true or false", [detail({ retry: "yes" as never })], [true]],
  ])("refuses %s", (_, raw, answers) => {
    expect(typeof parseAttemptDetails(raw, answers)).toBe("string");
  });
});
