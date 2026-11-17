// Studying a deck: preview, answers and feedback, points, results, retrying.
import {
  answer,
  expect,
  importDeck,
  nextCard,
  PLANET_ANSWERS,
  playRound,
  serverSession,
  sessionBar,
  startDeck,
  startGuest,
  test,
  unique,
} from "./support";

// Points: 10 for each right answer, plus 5 for each one on a streak of 3 or more.
// The planets deck right, right, right, wrong: 10 + 10 + 15 + 0 = 35.

test.describe("studying a deck", () => {
  let deck: string;
  let name: string;

  test.beforeEach(async ({ page }) => {
    name = unique("Quiz");
    deck = unique("Planets ");
    await startGuest(page, name);
    await importDeck(page, deck);
    await expect(page.getByRole("heading", { name: deck, level: 2 })).toBeVisible();
  });

  test("plays a whole round: preview, feedback, points, results and review @mobile", async ({ page }) => {
    await page.getByRole("button", { name: `Study ${deck}` }).click();
    await expect(page.getByText("Your next discovery")).toBeVisible();
    await expect(page.getByText("4 questions · Uncategorized")).toBeVisible();
    await page.getByRole("button", { name: /Start practice/ }).click();

    // 1: right, with its explanation.
    await expect(page.getByLabel("Progress")).toContainText("1 / 4");
    await answer(page, "Mercury");
    const feedback = page.locator(".field-feedback");
    await expect(feedback).toContainText("✓ That's right");
    await expect(feedback).toContainText("Mercury orbits closest to the Sun.");
    await expect(feedback).toContainText("+10 points");
    await nextCard(page);

    // 2 and 3: right; the third is on a streak, so it earns the bonus.
    await answer(page, "Mars");
    await nextCard(page);
    await answer(page, "Jupiter");
    await expect(feedback).toContainText("+15 points");
    await nextCard(page);

    // 4: wrong.
    await expect(page.getByRole("button", { name: /See results|Next question/ })).toHaveCount(0);
    await answer(page, "Mercury");
    await expect(feedback).toContainText("Not quite");
    await expect(feedback).toContainText("The answer is Saturn.");
    await expect(feedback).toContainText("You chose Mercury.");
    await expect(feedback).not.toContainText("points");
    await expect(page.getByLabel("35 points this round")).toBeVisible();
    await nextCard(page);

    // Results.
    await expect(page.getByRole("heading", { name: "3 of 4 correct" })).toBeVisible();
    await expect(page.getByRole("img", { name: "75% correct" })).toBeVisible();
    await expect(page.locator(".points-summary")).toContainText("+35");
    await expect(page.locator(".points-summary")).toContainText("This session 35");
    await expect(page.locator(".points-summary")).toContainText("All-time total 35");
    const review = page.locator(".review__item");
    await expect(review).toHaveCount(4);
    await expect(review.nth(3)).toContainText("You chose: Mercury");
    await expect(review.nth(3)).toContainText("Saturn's rings are made mostly of ice.");
    await expect(sessionBar(page)).toContainText("35 pts");
    expect(await serverSession(page)).toMatchObject({ points: 35 });
  });

  test("practising the missed questions replays only those", async ({ page }) => {
    await startDeck(page, deck);
    await playRound(page, ["Venus", "Mars", "Earth", "Saturn"]); // 1 and 3 wrong
    await expect(page.getByRole("heading", { name: "2 of 4 correct" })).toBeVisible();

    await page.getByRole("button", { name: "Practice missed questions (2)" }).click();
    await expect(page.getByText("Retrying missed")).toBeVisible();
    await expect(page.getByLabel("Progress")).toContainText("1 / 2");
    await expect(page.getByRole("heading", { name: "Which planet is closest to the Sun?" })).toBeVisible();
    await playRound(page, ["Mercury", "Jupiter"]);

    await expect(page.getByRole("heading", { name: "2 of 2 correct" })).toBeVisible();
    await expect(page.getByText(`${deck} · missed questions`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Practice missed/ })).toHaveCount(0);
    // 10 + 10 in the first round, then 10 + 10 for the retried two.
    await expect(sessionBar(page)).toContainText("40 pts");
  });

  test("restart starts the deck over; explore goes back to the list", async ({ page }) => {
    await startDeck(page, deck);
    await playRound(page, PLANET_ANSWERS);
    await expect(page.getByRole("heading", { name: "4 of 4 correct" })).toBeVisible();
    await expect(page.getByText("Every question answered. Wonderful work!")).toBeVisible();

    await page.getByRole("button", { name: "Restart deck" }).click();
    await expect(page.getByLabel("Progress")).toContainText("1 / 4");
    await expect(page.getByLabel("0 points this round")).toBeVisible();

    await page.getByRole("button", { name: "← Decks" }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  });

  test("works with the keyboard: number or letter keys answer, Enter moves on", async ({ page }) => {
    await startDeck(page, deck);
    await page.keyboard.press("1"); // Mercury
    await expect(page.locator(".field-feedback")).toContainText("That's right");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Progress")).toContainText("2 / 4");
    await page.keyboard.press("b"); // Mars
    await expect(page.locator(".field-feedback")).toContainText("That's right");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("Progress")).toContainText("3 / 4");
    await page.keyboard.press("9"); // no 9th option: nothing happens
    await expect(page.locator(".field-feedback")).toHaveCount(0);
  });

  test("the leaderboard shows the guest, marked as You, after earning points", async ({ page }) => {
    await startDeck(page, deck);
    await playRound(page, PLANET_ANSWERS); // 50 points
    const board = page.locator(".results__board details");
    await board.getByText("🏆 Leaderboard").click();
    const me = board.locator(".leaderboard__row.is-you");
    await expect(me).toContainText(name);
    await expect(me).toContainText("You");
    await expect(me).toContainText("50 pts");
  });
});

test.describe("regressions while studying", () => {
  test.beforeEach(async ({ page }) => {
    await startGuest(page, unique("Reg"));
    await importDeck(page, "Regression planets");
    await startDeck(page, "Regression planets");
  });

  test("points are saved after every answer, even when leaving a deck early (PR #8)", async ({ page }) => {
    await answer(page, "Mercury");
    await nextCard(page);
    await answer(page, "Mars");
    // Saved without finishing the round.
    await expect.poll(async () => (await serverSession(page))?.points).toBe(20);

    await page.getByRole("button", { name: "← Decks" }).click();
    await expect(sessionBar(page)).toContainText("20 pts");
    await page.reload();
    await expect(sessionBar(page)).toContainText("20 pts");
  });

  test("a fast double tap on Next doesn't skip a card (PR #8)", async ({ page }) => {
    await answer(page, "Mercury");
    // Two clicks before the screen can update, like a double tap on a phone.
    await page.getByRole("button", { name: /^Next question/ }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByLabel("Progress")).toContainText("2 / 4");
    await expect(page.getByRole("heading", { name: "Which planet is known as the Red Planet?" })).toBeVisible();
  });

  test("a fast double tap on an answer counts it once", async ({ page }) => {
    await page.locator(".options").getByRole("button", { name: "Mercury", exact: true }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.locator(".field-feedback")).toContainText("+10 points");
    await expect(page.getByLabel("10 points this round")).toBeVisible();
    await expect.poll(async () => (await serverSession(page))?.points).toBe(10);
  });

  test("a double tap on See results finishes the round once", async ({ page }) => {
    for (const pick of PLANET_ANSWERS.slice(0, 3)) {
      await answer(page, pick);
      await nextCard(page);
    }
    await answer(page, "Saturn");
    await page.getByRole("button", { name: /^See results/ }).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(page.getByRole("heading", { name: "4 of 4 correct" })).toBeVisible();
    await expect(page.locator(".points-summary")).toContainText("This session 50");
    expect(await serverSession(page)).toMatchObject({ points: 50 });
  });
});
