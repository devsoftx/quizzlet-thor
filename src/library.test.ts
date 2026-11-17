import { describe, expect, it } from "vitest";
import type { AccountDeck } from "./account-shared";
import { accountDecksFor, deckIsFor } from "./library";

const YAML = `title: From the file
enabled: false
cards:
  - question: 2 + 2?
    options: [3, 4]
    answer: 4
`;

const deck = (patch: Partial<AccountDeck>): AccountDeck => ({
  id: "d1",
  title: "Family maths",
  description: null,
  cardCount: 1,
  yaml: YAML,
  enabled: true,
  profileIds: null,
  createdAt: "2026-11-12T00:00:00.000Z",
  updatedAt: "2026-11-12T00:00:00.000Z",
  ...patch,
});

describe("a parent's decks for a kid", () => {
  it("shows switched-on decks meant for every kid or for this one", () => {
    expect(deckIsFor(deck({}), "kid-a")).toBe(true);
    expect(deckIsFor(deck({ profileIds: ["kid-a"] }), "kid-a")).toBe(true);
    expect(deckIsFor(deck({ profileIds: ["kid-b"] }), "kid-a")).toBe(false);
    expect(deckIsFor(deck({ profileIds: [] }), "kid-a")).toBe(false);
    expect(deckIsFor(deck({ enabled: false }), "kid-a")).toBe(false);
  });

  it("uses the account's title and on/off, not the file's", () => {
    const [entry] = accountDecksFor([deck({}), deck({ id: "d2", profileIds: ["kid-b"] })], "kid-a");
    expect(entry).toMatchObject({ id: "account:d1", source: "account", ok: true, deck: { title: "Family maths", enabled: true } });
  });
});

describe("deck search", () => {
  it("searches title and description and filters only real subject metadata", async () => {
    const { filterDecks } = await import("./library");
    const entries = accountDecksFor([
      deck({ id: "a", title: "Solar system", yaml: YAML.replace("title: From the file", "title: From the file\nsubject: Space") }),
      deck({ id: "b", title: "Math facts" }),
    ], "kid-a");
    expect(filterDecks(entries, "SOLAR", "").map((e) => e.id)).toEqual(["account:a"]);
    expect(filterDecks(entries, "", "Space").map((e) => e.id)).toEqual(["account:a"]);
    expect(filterDecks(entries, "", "__uncategorized__").map((e) => e.id)).toEqual(["account:b"]);
    expect(filterDecks(entries, "no such deck", "")).toEqual([]);
    expect(filterDecks([...entries, { id: "bad", fileName: "bad.yaml", source: "imported", ok: false, errors: ["invalid"], enabled: true }], "", "").some((e) => e.id === "bad")).toBe(false);
  });
});
