// The deck list: importing deck files, searching, problems with a file, the template.
import { readFile } from "node:fs/promises";
import { brokenDeckYaml, deckYaml, expect, importDeck, startGuest, test, unique } from "./support";

test.describe("deck library", () => {
  test.beforeEach(async ({ page }) => {
    await startGuest(page, unique("Lib"));
  });

  test("an imported deck is tagged, kept after a reload and can be removed", async ({ page }) => {
    const title = unique("Kept ");
    await importDeck(page, title);
    const card = page.locator("article.deck", { has: page.getByRole("heading", { name: title }) });
    await expect(card).toContainText("Imported");
    await expect(card).toContainText("4 questions");

    await page.reload();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Remove" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test("search narrows the list and says when nothing matches", async ({ page }) => {
    const comets = unique("Comets ");
    const oceans = unique("Oceans ");
    await importDeck(page, comets);
    await importDeck(page, oceans, deckYaml(oceans, { description: "Tides and currents" }));
    const search = page.getByLabel("Search decks");

    await search.fill(comets);
    await expect(page.getByRole("button", { name: `Study ${comets}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Study ${oceans}` })).toHaveCount(0);

    await search.fill("tides and currents"); // descriptions count too, any case
    await expect(page.getByRole("button", { name: `Study ${oceans}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Study ${comets}` })).toHaveCount(0);

    await search.fill("zzz no such deck zzz");
    await expect(page.getByText("No decks match that search.")).toBeVisible();

    await search.fill("");
    await expect(page.getByRole("button", { name: `Study ${comets}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Study ${oceans}` })).toBeVisible();
  });

  test("decks can be filtered by subject", async ({ page }) => {
    const subject = unique("Astro");
    const tagged = unique("Tagged ");
    const plain = unique("Plain ");
    await importDeck(page, tagged, deckYaml(tagged, { subject }));
    await importDeck(page, plain);
    await expect(page.locator("article.deck", { hasText: tagged })).toContainText(subject);
    await expect(page.locator("article.deck", { hasText: plain })).toContainText("Uncategorized");

    await page.getByLabel("Subject").selectOption(subject);
    await expect(page.getByRole("button", { name: `Study ${tagged}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Study ${plain}` })).toHaveCount(0);

    await page.getByLabel("Subject").selectOption("__uncategorized__");
    await expect(page.getByRole("button", { name: `Study ${plain}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Study ${tagged}` })).toHaveCount(0);
  });

  test("a broken deck file lists its problems instead of a Study button", async ({ page }) => {
    const title = unique("Broken ");
    await importDeck(page, title, brokenDeckYaml(title));
    const card = page.locator("article.deck--error", { hasText: "This deck has problems:" });
    await expect(card).toBeVisible();
    await expect(card).toContainText('answer "Pluto" is not one of the options.');
    await expect(card.getByRole("button", { name: /Study/ })).toHaveCount(0);
    await card.getByRole("button", { name: "Remove" }).click();
    await expect(card).toHaveCount(0);
  });

  test("an enabled file with no cards is explained", async ({ page }) => {
    await importDeck(page, "Not a deck", "enabled: true\ntitle: Empty\nrandom: text\n");
    await expect(page.locator("article.deck--error")).toContainText('The file needs a "cards:" list.');
  });

  test("a deck that isn't enabled is hidden, with a hint how to show it", async ({ page }) => {
    const title = unique("Off ");
    await importDeck(page, title, deckYaml(title, { enabled: false }));
    await expect(page.getByRole("button", { name: `Study ${title}` })).toHaveCount(0);
    const hidden = page.locator("details.hidden-decks");
    await hidden.locator("summary").click();
    await expect(hidden).toContainText(title);
    await expect(hidden).toContainText("enabled: true");
  });

  test("the deck template downloads and is a valid, enabled deck", async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".app-header__actions").getByRole("link", { name: "Download template" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("quizzlet-deck-template.yaml");
    const text = await readFile(await download.path(), "utf8");
    expect(text).toMatch(/^enabled: true/m);
    expect(text).toMatch(/^cards:/m);

    // And the app accepts it as is.
    await importDeck(page, "Template", text);
    await expect(page.locator("article.deck--error")).toHaveCount(0);
    await expect(page.locator("article.deck", { hasText: "Imported" }).getByRole("button", { name: /^Study / })).toBeVisible();
  });

  test("the format help explains how to write a deck", async ({ page }) => {
    await page.getByText("How to write a deck (YAML format)").click();
    const help = page.locator("details.format-help");
    await expect(help).toContainText("answer must match one of the options exactly");
    await expect(help.getByRole("link", { name: "Download the deck template" })).toBeVisible();
  });
});
