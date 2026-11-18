// Things going wrong: no connection, server errors, refused saves, sessions ending.
// The network is interrupted on purpose with page.route; the app must explain
// what happened, keep the learner's work where it can, and offer a way on.
import {
  answer,
  asParent,
  expect,
  importDeck,
  nextCard,
  PLANET_ANSWERS,
  profileTile,
  serverSession,
  sessionBar,
  signInParent,
  startDeck,
  startGuest,
  test,
  unique,
} from "./support";

test.describe("starting a session", () => {
  test("no connection: explained, and trying again works", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/session", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
    await page.getByLabel("Your nickname").fill(unique("Offline"));
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Can't reach the server. Check your internet connection.");
    await expect(page.getByRole("button", { name: /Start exploring/ })).toBeEnabled();

    await page.unroute("**/api/session");
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  });

  test("a server error is shown, not swallowed", async ({ page }) => {
    await page.goto("/");
    await page.route("**/api/session", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "oops" }) : route.continue()));
    await page.getByLabel("Your nickname").fill(unique("Down"));
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Something went wrong (500).");
  });

  test("a nickname that isn't allowed is explained", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your nickname").fill("!!!");
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Please enter a nickname (up to 24 letters, numbers or spaces).");
  });

  test("the welcome screen still works when the leaderboard can't load", async ({ page }) => {
    await page.route("**/api/leaderboard", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await expect(page.getByText("Couldn't load the leaderboard right now.")).toBeVisible();
    await page.getByLabel("Your nickname").fill(unique("NoBoard"));
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  });
});

test.describe("saving points", () => {
  test.beforeEach(async ({ page }) => {
    await startGuest(page, unique("Saver"));
    await importDeck(page, "Saving planets");
    await startDeck(page, "Saving planets");
  });

  test("a lost save is flagged, and Retry saving sends it", async ({ page }) => {
    await page.route("**/api/score", (route) => route.abort("internetdisconnected"));
    await answer(page, "Mercury");
    await expect(page.getByText("We couldn't confirm whether your latest points were saved")).toBeVisible();

    await page.getByRole("button", { name: "← Decks" }).click();
    const banner = page.locator(".save-problem");
    await expect(banner).toContainText("Some recent points have not been confirmed.");

    await page.unroute("**/api/score");
    await banner.getByRole("button", { name: "Retry saving" }).click();
    await expect(banner).toHaveCount(0);
    await expect(sessionBar(page)).toContainText("10 pts");
    expect(await serverSession(page)).toMatchObject({ points: 10 });
  });

  test("a save the server got, but whose answer was lost, isn't counted twice (PR #10)", async ({ page }) => {
    // The server saves the points, then the connection drops before the reply arrives.
    await page.route("**/api/score", async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    });
    await answer(page, "Mercury");
    await expect(page.getByText("We couldn't confirm whether your latest points were saved")).toBeVisible();
    expect(await serverSession(page)).toMatchObject({ points: 10 });

    // The retry sends the same batch again; the server recognises it.
    await page.unroute("**/api/score");
    await page.getByRole("button", { name: "← Decks" }).click();
    await expect(sessionBar(page)).toContainText("10 pts");
    await expect(page.locator(".save-problem")).toHaveCount(0);
    expect(await serverSession(page)).toMatchObject({ points: 10 });
  });

  test("a refused save is reported, with no retry offered", async ({ page }) => {
    await page.route("**/api/score", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This score belongs to a different session." }) }),
    );
    await answer(page, "Mercury");
    await expect(page.getByText("Your latest points could not be saved")).toBeVisible();
    await page.getByRole("button", { name: "← Decks" }).click();
    const banner = page.locator(".save-problem");
    await expect(banner).toContainText("Some recent points were rejected. End this session and start a new one.");
    await expect(banner.getByRole("button", { name: "Retry saving" })).toHaveCount(0);
  });

  test("asked to slow down: the points wait, and are saved when sent again", async ({ page }) => {
    await page.route("**/api/score", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "3" },
        body: JSON.stringify({ error: "You're answering faster than points can be saved. Wait a moment and try again." }),
      }),
    );
    await answer(page, "Mercury");
    await expect(page.getByText("Slow down a little: your latest points are waiting to be saved")).toBeVisible();
    expect(await serverSession(page)).toMatchObject({ points: 0 });

    // Not lost and not rejected: the same answers go out again and count once.
    await page.getByRole("button", { name: "← Decks" }).click();
    const banner = page.locator(".save-problem");
    await expect(banner).toContainText("Some recent points have not been confirmed.");
    await page.unroute("**/api/score");
    await banner.getByRole("button", { name: "Retry saving" }).click();
    await expect(banner).toHaveCount(0);
    await expect(sessionBar(page)).toContainText("10 pts");
    expect(await serverSession(page)).toMatchObject({ points: 10 });
  });

  test("the server ends the session mid-round: the round can be finished, then a new session started", async ({ page }) => {
    await page.route("**/api/score", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Your session has ended. Start a new one to save points." }) }),
    );
    for (const pick of PLANET_ANSWERS) {
      await answer(page, pick);
      await nextCard(page);
    }
    await expect(page.getByRole("heading", { name: "4 of 4 correct" })).toBeVisible();
    const problem = page.locator(".save-problem");
    await expect(problem).toContainText("Your session ended. 0 points were confirmed in this session.");
    await problem.getByRole("button", { name: "Start a new session" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText("Your session has ended. Recent points may not have been confirmed. Enter your name to start a new one.")).toBeVisible();
  });
});

test.describe("the 60-minute session", () => {
  test("the bar warns near the end, and the session ends on time", async ({ page }) => {
    await page.clock.install();
    const name = unique("Timer");
    await startGuest(page, name);
    await expect(sessionBar(page)).toContainText("60 min left");

    await page.clock.fastForward("59:30");
    await expect(sessionBar(page)).toContainText("less than a minute left");

    await page.clock.fastForward("00:31");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText(`Your session has ended, ${name}. 0 points were confirmed. Enter your name to start a new session.`)).toBeVisible();
  });
});

test.describe("signed-in parent", () => {
  test("the account can't load: explained, and signing out still works", async ({ page }) => {
    await page.route("**/api/me", (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto("/");
    await page.getByRole("button", { name: "Parent or teacher sign in" }).click();
    await page.getByLabel("Parent test ID").fill(unique("parent-"));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Couldn't load your account: Something went wrong (500).");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });

  test("no connection when opening a private deck: explained, and the deck stays", async ({ page, request }) => {
    const parent = asParent(request, unique("parent-"));
    const kid = await parent.createProfile(unique("Kid"));
    const title = unique("Offline ");
    await parent.createDeck(title, [kid.id]);
    await signInParent(page, parent.headers["x-dev-user"]);
    await profileTile(page, kid.nickname).click();

    await page.route("**/api/session?deckId=*", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: `Study ${title}` }).click();
    await expect(page.getByRole("alert")).toContainText("This deck couldn't be opened. Check your connection or ask an adult.");
    await expect(page.getByRole("button", { name: `Study ${title}` })).toBeVisible();

    await page.unroute("**/api/session?deckId=*");
    await startDeck(page, title);
  });
});
