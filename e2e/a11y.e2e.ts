// Automated accessibility checks (axe-core) on every main screen. They catch a
// lot (missing labels, contrast, roles) but not everything: keyboard and
// screen-reader use still need a person.
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import {
  answer,
  asParent,
  expect,
  importDeck,
  newDevice,
  PLANET_ANSWERS,
  playRound,
  signInParent,
  startDeck,
  startGuest,
  test,
  unique,
} from "./support";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string[] }>;
}

/** Runs axe on the page and fails on serious or critical problems (WCAG 2.2 A and AA rules). */
async function expectAccessible(page: Page, screen: string) {
  await page.addScriptTag({ path: AXE });
  const violations: Violation[] = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Violation[] }> } }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations;
  });
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious, `accessibility problems on ${screen}`).toEqual([]);
}

test.describe("accessibility", () => {
  test("learner screens: welcome, decks, preview, question, feedback, results @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: /Leaderboard/ })).toBeVisible();
    await expectAccessible(page, "the welcome screen");

    await startGuest(page, unique("Axe"));
    await importDeck(page, "Accessible planets");
    await expectAccessible(page, "the deck list");

    await page.getByRole("button", { name: "Study Accessible planets" }).click();
    await expectAccessible(page, "the deck preview");

    await page.getByRole("button", { name: /Start practice/ }).click();
    await expectAccessible(page, "a question");
    await answer(page, "Venus");
    await expectAccessible(page, "the feedback after a wrong answer");

    await page.getByRole("button", { name: /^Next question/ }).click();
    await playRound(page, PLANET_ANSWERS.slice(1));
    await expectAccessible(page, "the results");
  });

  test("parent screens: home, profiles with a link, decks, files, settings", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    await parent.createProfile(unique("Kid"));
    await parent.createDeck(unique("Axe deck "));
    await signInParent(page, parent.headers["x-dev-user"]);
    await expectAccessible(page, "the parent home");

    await page.getByRole("button", { name: "Manage profiles" }).click();
    await page.getByRole("button", { name: "+ Add a profile" }).click();
    await page.getByLabel("Nickname", { exact: true }).fill(unique("Second"));
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByText(/^Send this link to/)).toBeVisible();
    await expectAccessible(page, "the profiles screen with a new link");

    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("button", { name: "My decks" }).click();
    await expectAccessible(page, "my decks");
    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("button", { name: "My files" }).click();
    await expect(page.getByText("No files yet.")).toBeVisible();
    await expectAccessible(page, "my files");
    await page.getByRole("button", { name: "← Back" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expectAccessible(page, "settings");
  });

  test("kid screens: the invitation and the kid's home", async ({ browser, request }) => {
    const parent = asParent(request, unique("parent-"));
    const kid = await parent.createProfile(unique("Kid"), true);
    const device = await newDevice(browser);
    await device.page.goto(`/#join=${await parent.createInvite(kid.id)}`);
    await expect(device.page.getByRole("heading", { name: `Study as ${kid.nickname}?` })).toBeVisible();
    await expectAccessible(device.page, "the invitation");

    await device.page.getByRole("button", { name: `Use this device as ${kid.nickname}` }).click();
    await expect(device.page.getByRole("region", { name: /Leaderboard/ })).toBeVisible();
    await expectAccessible(device.page, "the kid's home");
    await device.context.close();
  });

  test("the dark theme passes too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.getByRole("region", { name: /Leaderboard/ })).toBeVisible();
    await expectAccessible(page, "the welcome screen (dark)");
    await startGuest(page, unique("Dark"));
    await importDeck(page, "Dark planets");
    await startDeck(page, "Dark planets");
    await answer(page, "Mercury");
    await expectAccessible(page, "a question's feedback (dark)");
  });
});
