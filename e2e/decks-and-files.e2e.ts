// A parent's private library: decks (with who can see them) and study files.
import { readFile } from "node:fs/promises";
import {
  acceptNextDialog,
  asParent,
  brokenDeckYaml,
  deckYaml,
  expect,
  fileName,
  importDeck,
  profileTile,
  sessionBar,
  signInParent,
  startGuest,
  test,
  unique,
} from "./support";
import type { Page } from "@playwright/test";

async function addDeckFile(page: Page, title: string, yaml = deckYaml(title)) {
  await page.locator('input[type="file"][accept=".yaml,.yml"]').setInputFiles({
    name: fileName(title),
    mimeType: "text/yaml",
    buffer: Buffer.from(yaml),
  });
}

const deckRow = (page: Page, title: string) => page.locator(".manage__item", { has: page.getByText(title, { exact: true }) });

/** From the parent's home: study as a kid and come back, reporting whether the deck was in their list. */
async function kidSeesDeck(page: Page, kid: string, title: string): Promise<boolean> {
  await profileTile(page, kid).click();
  await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  const seen = (await page.getByRole("button", { name: `Study ${title}` }).count()) > 0;
  await sessionBar(page).getByRole("button", { name: "Switch profile" }).click();
  await expect(page.getByRole("heading", { name: "Who's exploring today?" })).toBeVisible();
  return seen;
}

test.describe("private decks", () => {
  test("adds a deck file, picks which kids see it, and switches it off", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    const ana = await parent.createProfile(unique("Ana"));
    const ben = await parent.createProfile(unique("Ben"));
    const title = unique("Volcanoes ");
    await signInParent(page, parent.headers["x-dev-user"]);

    await page.getByRole("button", { name: "My decks" }).click();
    await expect(page.getByRole("heading", { name: "Private decks" })).toBeVisible();
    await expect(page.getByText("No decks yet.")).toBeVisible();
    await addDeckFile(page, title);
    await expect(deckRow(page, title)).toContainText("4 cards · All kids");
    await expect(page.getByText("1 of 50 decks")).toBeVisible();

    // Only Ana.
    await page.getByRole("button", { name: `Edit "${title}"` }).click();
    await page.getByLabel("Only these kids:").check();
    await page.getByRole("checkbox", { name: ana.nickname, exact: true }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(deckRow(page, title)).toContainText(`4 cards · ${ana.nickname}`);

    await page.getByRole("button", { name: "← Back" }).click();
    expect(await kidSeesDeck(page, ben.nickname, title)).toBe(false);
    expect(await kidSeesDeck(page, ana.nickname, title)).toBe(true);

    // Switched off: hidden from everyone.
    await page.getByRole("button", { name: "My decks" }).click();
    // The switch follows the server, so it flips once the change is saved.
    const onSwitch = page.getByLabel(`Show "${title}" to kids`);
    await onSwitch.click();
    await expect(deckRow(page, title)).toContainText("Off: hidden from every kid");
    await expect(onSwitch).not.toBeChecked();
    await page.getByRole("button", { name: "← Back" }).click();
    expect(await kidSeesDeck(page, ana.nickname, title)).toBe(false);
  });

  test("a broken deck file is refused with the reasons", async ({ page }) => {
    const title = unique("Broken ");
    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "My decks" }).click();
    await addDeckFile(page, title, brokenDeckYaml(title));
    const problems = page.locator(".upload-problems");
    await expect(problems).toContainText(`${fileName(title)}: This deck has problems.`);
    await expect(problems).toContainText('answer "Pluto" is not one of the options.');
    await expect(page.getByText("No decks yet.")).toBeVisible();
  });

  test("renames, downloads and deletes a deck", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    const title = unique("Rename ");
    const renamed = unique("Renamed ");
    await parent.createDeck(title);
    await signInParent(page, parent.headers["x-dev-user"]);
    await page.getByRole("button", { name: "My decks" }).click();

    await page.getByRole("button", { name: `Edit "${title}"` }).click();
    await page.getByLabel("Title").fill(renamed);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(deckRow(page, renamed)).toBeVisible();

    await page.getByRole("button", { name: `Edit "${renamed}"` }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download YAML" }).click()]);
    expect(download.suggestedFilename()).toBe(fileName(renamed));
    expect(await readFile(await download.path(), "utf8")).toContain("Which planet is closest to the Sun?");

    acceptNextDialog(page, `Delete "${renamed}"? This can't be undone.`);
    await page.getByRole("button", { name: "Delete deck" }).click();
    await expect(page.getByText("No decks yet.")).toBeVisible();
  });

  test("decks imported in this browser before signing in can be copied into the account", async ({ page }) => {
    const title = unique("Browser ");
    await startGuest(page, unique("Guest"));
    await importDeck(page, title);
    await sessionBar(page).getByRole("button", { name: "End session" }).click();

    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "My decks" }).click();
    await expect(page.getByText("1 deck is saved only in this browser.")).toBeVisible();
    await page.getByRole("button", { name: "Copy to my account" }).click();
    await expect(deckRow(page, title)).toContainText("4 cards · All kids");
    await expect(page.getByText("saved only in this browser")).toHaveCount(0);
  });
});

// A tiny but real PDF.
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

async function uploadFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
}

test.describe("study files", () => {
  test("uploads, opens and deletes a file", async ({ page }) => {
    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "My files" }).click();
    await expect(page.getByRole("heading", { name: "Study files" })).toBeVisible();
    await expect(page.getByText("No files yet.")).toBeVisible();
    await expect(page.getByText("0 of 20 files")).toBeVisible();

    await uploadFile(page, "worksheet.pdf", "application/pdf", PDF);
    const row = page.locator(".manage__item", { hasText: "worksheet.pdf" });
    await expect(row).toContainText("PDF ·");
    await expect(page.getByText(/^1 of 20 files/)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Open worksheet.pdf" }).click()]);
    expect(download.suggestedFilename()).toBe("worksheet.pdf");
    expect(await readFile(await download.path())).toEqual(PDF);

    // Still there after a reload.
    await page.reload();
    await page.getByRole("button", { name: "My files" }).click();
    await expect(row).toBeVisible();

    acceptNextDialog(page, `Delete "worksheet.pdf"? This can't be undone.`);
    await page.getByRole("button", { name: "Delete worksheet.pdf" }).click();
    await expect(page.getByText("No files yet.")).toBeVisible();
  });

  test("refuses file types and sizes that aren't allowed", async ({ page }) => {
    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "My files" }).click();
    const problems = page.locator(".upload-problems");

    await uploadFile(page, "notes.txt", "text/plain", Buffer.from("just some notes"));
    await expect(problems).toContainText("notes.txt: Upload a PDF, Word (.docx), PNG, JPEG or WebP file.");

    await uploadFile(page, "big.pdf", "application/pdf", Buffer.alloc(15 * 1024 * 1024 + 1, 0x20));
    await expect(problems).toContainText("big.pdf: Files can be up to 15 MB.");

    await uploadFile(page, "empty.pdf", "application/pdf", Buffer.alloc(0));
    await expect(problems).toContainText("empty.pdf: That file is empty.");

    await expect(page.getByText("No files yet.")).toBeVisible();
  });

  test("files are private to the account that uploaded them", async ({ page, request }) => {
    const owner = asParent(request, unique("owner-"));
    await signInParent(page, owner.headers["x-dev-user"]);
    await page.getByRole("button", { name: "My files" }).click();
    await uploadFile(page, "private.pdf", "application/pdf", PDF);
    await expect(page.locator(".manage__item", { hasText: "private.pdf" })).toBeVisible();

    const { files } = await (await request.get("/api/files", { headers: owner.headers })).json();
    const id = files[0].id as string;
    const stranger = { headers: asParent(request, unique("stranger-")).headers };
    expect((await request.get(`/api/files?id=${id}`, stranger)).status()).toBe(404);
    expect((await request.delete(`/api/files?id=${id}`, stranger)).status()).toBe(404);
    expect((await (await request.get("/api/files", stranger)).json()).files).toEqual([]);
    expect((await request.get(`/api/files?id=${id}`)).status()).toBe(401); // signed out
  });
});
