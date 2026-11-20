// A parent's Progress page: a kid's answers, card by card.
import { answer, asParent, deckYaml, expect, nextCard, PLANETS, sessionBar, signInParent, studyAsKid, test, unique, type TestCard } from "./support";

/** The planets deck with the first two cards easy and the last two hard. */
const GRADED: TestCard[] = PLANETS.map((card, i) => ({ ...card, difficulty: i < 2 ? "easy" : "hard" }));

test.describe("the Progress page", () => {
  test("shows a kid's right and wrong answers, retries, changed answers and mistakes by difficulty", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    const kid = await parent.createProfile(unique("Kid"));
    const deck = unique("Graded planets ");
    await parent.createDeck(deck, null, deckYaml(deck, { cards: GRADED }));
    await signInParent(page, parent.headers["x-dev-user"]);

    // Card 1 right after changing their mind, 2 wrong, 3 right, 4 wrong…
    await studyAsKid(page, kid.nickname, deck, [["Venus", "Mercury"], ["Jupiter"], ["Jupiter"], ["Mercury"]]);
    await expect(page.getByRole("heading", { name: "2 of 4 correct" })).toBeVisible();
    // …then both missed cards right on the first retry.
    await page.getByRole("button", { name: /Practice missed questions/ }).click();
    await answer(page, "Mars");
    await nextCard(page);
    await answer(page, "Saturn");
    await nextCard(page);
    await expect(page.locator(".points-summary")).toBeVisible(); // every answer is saved
    await sessionBar(page).getByRole("button", { name: "Switch profile" }).click();

    await page.getByRole("button", { name: "Progress" }).click();
    await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Kid")).toHaveValue(kid.id);
    const tile = (label: string) => page.locator(".stat-tile", { hasText: label });
    await expect(tile("Cards answered")).toContainText("6");
    await expect(tile("Cards answered")).toContainText("67% right");
    await expect(tile("Changed their answer")).toContainText("1");
    await expect(tile("Retries on missed cards")).toContainText("2 of 2 missed cards now right");

    const card = (title: string) => page.locator(".chart-card", { has: page.getByRole("heading", { name: title }) });
    const rightWrong = card("Right and wrong answers");
    await expect(rightWrong.locator(".seg-bars__row", { hasText: "Easy" })).toContainText("2 right · 1 wrong · 67%");
    await expect(rightWrong.locator(".seg-bars__row", { hasText: "Medium" })).toContainText("0 answers");
    await expect(rightWrong.locator(".seg-bars__row", { hasText: "Hard" })).toContainText("2 right · 1 wrong · 67%");
    await expect(card("Retries on missed cards").locator(".count-bars li", { hasText: "Right on the 1st retry" })).toContainText("2 cards");

    // Every chart has its numbers as a table too.
    const changes = card("Changed answers before checking");
    await changes.getByText("Show as a table").click();
    await expect(changes.getByRole("row", { name: /Easy/ })).toContainText("33% (1)");
    const mistakes = card("Where the mistakes are");
    await mistakes.getByText("Show as a table").click();
    await expect(mistakes.getByRole("row")).toHaveCount(4); // the header and all three levels
    await expect(mistakes.getByRole("row", { name: /Medium/ })).toContainText("0%");
    await expect(page.getByRole("img", { name: "Learning profile" })).toBeVisible();

    // Filters scope everything: a deck, and a shorter period.
    await page.getByLabel("Deck").selectOption({ label: deck });
    await expect(tile("Cards answered")).toContainText("6");
    await page.getByLabel("Period").selectOption({ label: "Last 7 days" });
    await expect(tile("Cards answered")).toContainText("6");
  });

  test("says so when a kid has no answers yet, and keeps parents apart", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    const kid = await parent.createProfile(unique("Kid"));
    await signInParent(page, parent.headers["x-dev-user"]);
    await page.getByRole("button", { name: "Progress" }).click();
    await expect(page.getByText(`No answers from ${kid.nickname} in this period yet.`)).toBeVisible();

    const other = asParent(request, unique("parent-"));
    const res = await request.get(`/api/progress?profileId=${kid.id}`, { headers: other.headers });
    expect(res.status()).toBe(404);
  });
});
