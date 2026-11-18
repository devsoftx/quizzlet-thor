// The end-to-end tests' name helper, checked by the unit test run (Vitest):
// a name it makes must never be one the app refuses, or an end-to-end test
// fails by chance.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkName, NAME_MAX } from "../server/names";
import { randomTail, unique } from "./unique";

/** Every prefix the end-to-end tests pass to unique(), read from their source. */
function prefixesInUse(): string[] {
  const dir = new URL(".", import.meta.url);
  const found = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".e2e.ts"))) {
    for (const call of readFileSync(new URL(file, dir), "utf8").matchAll(/unique\("([^"]*)"\)/g)) found.add(call[1]);
  }
  return [...found].sort();
}

/** A tail source that hands out the given tails in order, then safe ones. */
function tails(...first: string[]): () => string {
  const queue = [...first];
  return () => queue.shift() ?? "2689268926"; // digits that never stand in for letters
}

describe("unique() names for the end-to-end tests", () => {
  it("draws again when the random part would spell a blocked word", () => {
    // What a CI run drew for the dark-theme test: the server answered "Please choose a different nickname."
    expect(checkName("Darky3r4arlred")).toEqual({ ok: false, problem: "blocked" });
    expect(unique("Dark", tails("y3r4arlred"))).toBe("Dark2689268926");

    // Also when it takes several tries, and when digits stand in for letters ("13" reads as "ie").
    expect(checkName("Darki3")).toEqual({ ok: false, problem: "blocked" });
    expect(unique("Dark", tails("y9aaaaaaaa", "13", "ie2bbbbbbb"))).toBe("Dark2689268926");
  });

  it("keeps a tail that is fine", () => {
    expect(unique("Nova", tails("k3x9q2m7pz"))).toBe("Novak3x9q2m7pz");
  });

  it("makes only names the app accepts, for every prefix the tests use", () => {
    const prefixes = prefixesInUse();
    expect(prefixes.length).toBeGreaterThan(30); // the scan still finds the calls
    expect(prefixes).toContain("Dark");
    const wrong: string[] = [];
    for (const prefix of prefixes) {
      for (let i = 0; i < 1000; i++) {
        const name = unique(prefix);
        if (!checkName(name).ok || !name.startsWith(prefix) || name.length > NAME_MAX) wrong.push(name);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("really does need the second draw: the raw random names are sometimes refused", () => {
    // Without the check, this many draws for "Dark" always include some "Darky…" and "Darkie…".
    let refused = 0;
    for (let i = 0; i < 20_000; i++) if (!checkName(`Dark${randomTail()}`).ok) refused++;
    expect(refused).toBeGreaterThan(0);
  });

  it("gives different names every time", () => {
    const names = new Set(Array.from({ length: 20_000 }, () => unique("Kid")));
    expect(names.size).toBe(20_000);
    expect(randomTail()).toMatch(/^[0-9a-z]{10}$/);
  });

  it("says so, instead of trying forever, when the prefix itself can't be used", () => {
    expect(() => unique("<b>")).toThrow(/the app refuses every name with this prefix \(invalid\)/);
    expect(() => unique("Darky ")).toThrow(/refuses every name with this prefix \(blocked\)/);
    expect(() => unique("A prefix that is too long")).toThrow(/leaves no room for a random part/);
  });
});
