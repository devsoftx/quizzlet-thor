// Every message the server can show people has a Spanish version.
//
// Reads the server's code for the messages it sends (error(…) calls and the
// constants and checks they use), so a new message without a translation fails
// here rather than reaching Spanish-speaking learners in English.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { translateServerMessage } from "./server-messages";

const SERVER = new URL("../../server/", import.meta.url);

/** API-contract messages only a broken or hand-made request can get: the app never shows them. */
const NOT_SHOWN = new Set([
  "answers must be a list of true/false values.",
  "streakBefore must be a whole number.",
  "enabled must be true or false.",
  "showOnLeaderboard must be true or false.",
  "profileIds must be null or a list of profile ids.",
  "Not allowed.",
  "The scheduled cleanup isn't set up yet (CRON_SECRET).",
  "Uploads go through /api/files in local mode.",
  "Upload straight to Blob storage.",
]);

/** A template literal's ${…} parts, filled with values like the real ones. */
const sample = (template: string) => template.replace(/\$\{[^}]+\}/g, "7");

function serverMessages(): string[] {
  const found = new Set<string>();
  for (const name of readdirSync(SERVER)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "test-support.ts") continue;
    const code = readFileSync(new URL(name, SERVER), "utf8");
    const patterns = [
      /\berror\(\d{3},\s*"([^"]+)"/g, // error(400, "…")
      /\berror\(\d{3},\s*`([^`]+)`/g, // error(400, `…${n}…`)
      /\bjson\(\{\s*error:\s*"([^"]+)"/g, // json({ error: "…" })
      /\bconst [A-Z_]+ = "([^"\n]+)";/g, // const LINK_GONE = "…";
      /\bconst [A-Z_]+ = `([^`\n]+)`;/g, // one line: longer templates are scripts, not messages
      /\brefused\("[^"]+",\s*"([^"]+)"/g, // refused("reason", "…")
      /\["[a-z]+",\s*"([^"]+)"\]\s*as const/g, // ["size", "…"] as const
      /\? "([A-Z][^"]+\.)"\s*\n?\s*: "([A-Z][^"]+\.)"/g, // cond ? "One." : "Other."
      /uploaded \? "([^"]+)" : "([^"]+)"/g,
      /^\s+(?:if \(.+\) )?return "([A-Z][^"]*\.)";/gm, // validation helpers: return "Unknown color.";
    ];
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) {
        for (const message of match.slice(1)) if (message && /[a-z] /.test(message)) found.add(sample(message));
      }
    }
  }
  return [...found].sort();
}

describe("server messages in Spanish", () => {
  const messages = serverMessages();

  it("finds the server's messages", () => {
    // A sanity check on the scan itself: these are spread over several files.
    expect(messages).toEqual(
      expect.arrayContaining([
        "That nickname is taken. Please pick another one.",
        "This link has expired or was already used. Ask your parent for a new one.",
        "This device is no longer linked. Ask an adult for a new link.",
        "You can keep up to 7 decks.",
        "That file type isn't allowed.",
      ]),
    );
    expect(messages.length).toBeGreaterThan(40);
  });

  it("translates every message people can see", () => {
    const untranslated = messages.filter((m) => !NOT_SHOWN.has(m) && translateServerMessage(m, "es") === m);
    expect(untranslated).toEqual([]);
  });

  it("covers the nickname messages, which are built from parts", async () => {
    const { nameProblemMessage } = await import("../../server/names");
    for (const problem of ["invalid", "mixed-scripts", "blocked"] as const) {
      for (const what of ["nickname", "name"]) {
        const english = nameProblemMessage(problem, what);
        expect(translateServerMessage(english, "es"), english).not.toBe(english);
      }
    }
  });

  it("keeps names and numbers, and leaves English alone", () => {
    expect(translateServerMessage("Nova already has 10 devices. Remove one first.", "es")).toBe("Nova ya tiene 10 dispositivos. Quita uno primero.");
    expect(translateServerMessage("Files can be up to 15 MB.", "es")).toBe("Los archivos pueden pesar hasta 15 MB.");
    expect(translateServerMessage("Files can be up to 15 MB, and no bigger than the file you picked.", "es")).toBe(
      "Los archivos pueden pesar hasta 15 MB, y no más que el archivo que elegiste.",
    );
    expect(translateServerMessage("That nickname is taken. Please pick another one.", "en")).toBe("That nickname is taken. Please pick another one.");
    expect(translateServerMessage("Something nobody translated.", "es")).toBe("Something nobody translated.");
  });
});
