// A guest (no account): the welcome screen, starting, resuming and ending a session.
import { expect, sessionBar, serverSession, startGuest, test, unique } from "./support";

test.describe("guest", () => {
  test("the welcome screen loads cleanly and shows the public leaderboard @mobile", async ({ page }) => {
    const apiFailures: string[] = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/") && res.status() >= 400) apiFailures.push(`${res.status()} ${new URL(res.url()).pathname}`);
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText(/appears on the public leaderboard/)).toBeVisible();

    // Regression (PR #9, lost in the redesign): the leaderboard is on the home screen, no sign-in needed.
    const board = page.getByRole("region", { name: /Leaderboard/ });
    await expect(board).toBeVisible();
    await expect(board.getByText("Loading…")).toHaveCount(0);
    await expect(board.getByText("Couldn't load the leaderboard right now.")).toHaveCount(0);

    // Regression: asking for a session when there is none is a normal answer, not a failed request.
    expect(apiFailures).toEqual([]);
  });

  test("a nickname is required to start", async ({ page }) => {
    await page.goto("/");
    const start = page.getByRole("button", { name: /Start exploring/ });
    await expect(start).toBeDisabled();
    await page.getByLabel("Your nickname").fill("   ");
    await expect(start).toBeDisabled();
    await page.getByLabel("Your nickname").fill("Nova7");
    await expect(start).toBeEnabled();
  });

  test("starts a session, keeps it after a reload and ends it @mobile", async ({ page }) => {
    const name = unique("Nova");
    await startGuest(page, name);

    await expect(sessionBar(page)).toContainText(name);
    await expect(sessionBar(page)).toContainText("0 pts");
    await expect(sessionBar(page)).toContainText("60 min left");
    expect(await serverSession(page)).toMatchObject({ name, points: 0, profileId: null });

    // The session survives a reload (it lives in a cookie the page asks the server about).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
    await expect(sessionBar(page)).toContainText(name);

    await sessionBar(page).getByRole("button", { name: "End session" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    expect(await serverSession(page)).toBeNull();

    // Still ended after a reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("the same nickname can start again after ending", async ({ page }) => {
    const name = unique("Repeat");
    await startGuest(page, name);
    await sessionBar(page).getByRole("button", { name: "End session" }).click();
    await startGuest(page, name);
    await expect(sessionBar(page)).toContainText(name);
  });
});
