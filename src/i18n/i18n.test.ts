// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDeck } from "../deck";
import { en } from "./en";
import { es } from "./es";
import { browserLanguage, getLanguage, LANGUAGE_KEY, languageName, messagesFor, resetLanguage, setLanguage } from "./index";

afterEach(() => resetLanguage());

describe("choosing the language", () => {
  it("takes the first of the browser's languages the app speaks", () => {
    expect(browserLanguage(["es-MX", "en-US"])).toBe("es");
    expect(browserLanguage(["fr-FR", "es", "en"])).toBe("es");
    expect(browserLanguage(["en-GB", "es"])).toBe("en");
    expect(browserLanguage(["de-DE", "fr"])).toBe("en");
    expect(browserLanguage([])).toBe("en");
  });

  it("starts in English in a browser set to English", () => {
    expect(getLanguage()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("remembers a choice on this device and marks the page with it", () => {
    setLanguage("es");
    expect(getLanguage()).toBe("es");
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(messagesFor().welcome.start).toBe("Empezar a explorar");
  });

  it("follows a choice made in another tab", () => {
    window.dispatchEvent(new StorageEvent("storage", { key: LANGUAGE_KEY, newValue: "es" }));
    expect(getLanguage()).toBe("es");
    window.dispatchEvent(new StorageEvent("storage", { key: LANGUAGE_KEY, newValue: "klingon" }));
    expect(getLanguage()).toBe("es");
  });

  it("still switches when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setLanguage("es");
    expect(getLanguage()).toBe("es");
    vi.restoreAllMocks();
  });

  it("names deck languages in the app's language", () => {
    expect(languageName("es", "en")).toBe("Spanish");
    expect(languageName("en", "es")).toBe("Inglés");
    expect(languageName("es-MX", "es")).toMatch(/^Español/);
  });
});

// ------------------------------------------------------------- Catalogs

type Leaf = string | ((...args: never[]) => unknown);
/** Lookup tables, not messages: English needs no entries in them. */
const TABLES = new Set(["links.deviceWords"]);
function leaves(node: unknown, path = ""): Array<[string, Leaf]> {
  if (TABLES.has(path)) return [];
  if (typeof node === "string" || typeof node === "function") return [[path, node as Leaf]];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Text that is the same in both languages on purpose. */
const SAME_IN_BOTH = new Set([
  "myFiles.types.PDF", // product names
  "myFiles.types.Word",
  "profiles.color", // "Color" is Spanish too
]);

describe("the Spanish catalog", () => {
  const english = new Map(leaves(en));
  const spanish = new Map(leaves(es));

  it("has every English message, with the same parameters", () => {
    expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of english) {
      const other = spanish.get(key)!;
      expect(typeof other, key).toBe(typeof value);
      if (typeof value === "function") expect((other as (...a: never[]) => unknown).length, key).toBe(value.length);
    }
  });

  it("is actually in Spanish", () => {
    const untranslated = [...english].filter(
      ([key, value]) => typeof value === "string" && value === spanish.get(key) && !SAME_IN_BOTH.has(key),
    );
    expect(untranslated.map(([key]) => key)).toEqual([]);
    for (const [key, value] of spanish) if (typeof value === "string") expect(value.trim(), key).not.toBe("");
  });

  it("keeps every {placeholder}, so markup lands in the sentence", () => {
    for (const [key, value] of english) {
      if (typeof value === "string") expect(placeholders(spanish.get(key) as string), key).toEqual(placeholders(value));
    }
  });

  it("words counts, names and dates naturally", () => {
    expect(es.common.questionCount(1)).toBe("1 pregunta");
    expect(es.common.questionCount(12)).toBe("12 preguntas");
    expect(en.common.questionCount(1)).toBe("1 question");
    expect(es.common.pts(1234)).toBe("1,234 pts");
    expect(es.sessionBar.minutesLeft(1)).toBe("queda 1 min");
    expect(es.sessionBar.minutesLeft(5)).toBe("quedan 5 min");
    expect(es.app.sessionTimeUp("Nova", 1, false, true)).toBe(
      "Tu sesión terminó, Nova. Se confirmó 1 punto. Escribe tu apodo para empezar una sesión nueva.",
    );
    expect(en.app.sessionTimeUp("Nova", 0, true, false)).toBe(
      "Your session has ended, Nova. 0 points were confirmed. Some recent points could not be confirmed.",
    );
    expect(es.links.devicesOf("Nova")).toBe("Dispositivos de Nova");
    expect(es.results.percentCorrect(85)).toBe("85 % de aciertos");
    expect(es.profiles.deviceCount(0)).toBe("Ningún dispositivo vinculado");
    expect(es.profiles.deviceCount(2)).toBe("2 dispositivos vinculados");
  });

  it("shows an example deck that is a valid deck, in its own language", () => {
    for (const messages of [en, es]) {
      const result = parseDeck(messages.deckList.example, "example", messages.deck);
      expect(result.ok, messages.languageName).toBe(true);
      if (result.ok) expect(result.deck.language).toBe(messages === en ? "en" : "es");
    }
  });

  it("asks for a confirmation word people can type", () => {
    expect(es.settings.deleteWord).toBe("ELIMINAR");
    expect(en.settings.deleteWord).toBe("DELETE");
  });
});
