// Parents and teachers: signing in, kid profiles, settings, deleting the account,
// and one account's data staying private from another's.
import {
  acceptNextDialog,
  answer,
  asParent,
  deckYaml,
  expect,
  importDeck,
  nextCard,
  PLANET_ANSWERS,
  PLANETS,
  playRound,
  profileTile,
  sessionBar,
  signInParent,
  startDeck,
  test,
  unique,
} from "./support";

test.describe("parent account", () => {
  test("signs in, adds a kid with an invitation link, and the kid's points show on their tile", async ({ page }) => {
    const parent = unique("parent-");
    const kid = unique("Kid");
    await signInParent(page, parent);
    await expect(page.getByText(`Parent & teacher workspace · ${parent}`)).toBeVisible();
    await expect(page.getByText("No kid profiles yet.")).toBeVisible();

    // Add a profile: an invitation link for the kid's own device is made right away.
    await page.getByRole("button", { name: "Add a profile" }).click();
    await expect(page.getByRole("heading", { name: "Learner profiles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create profile" })).toBeDisabled();
    await page.getByLabel("Nickname", { exact: true }).fill(kid);
    await page.getByLabel(/Show this nickname on the public leaderboard/).check();
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByText(`Send this link to ${kid}.`)).toBeVisible();
    await expect(page.getByLabel(`Invitation link for ${kid}`)).toHaveValue(/\/#join=[A-Za-z0-9_-]{43}$/);
    await expect(page.locator(".manage__item", { hasText: kid })).toContainText("On the leaderboard");

    // Study as the kid on this device.
    await page.getByRole("button", { name: "← Back" }).click();
    await profileTile(page, kid).click();
    await expect(sessionBar(page)).toContainText(kid);
    await expect(sessionBar(page).getByRole("button", { name: "Switch profile" })).toBeVisible();

    // A deck imported during a kid's session goes into the family's private decks.
    const deck = unique("Family ");
    await importDeck(page, deck);
    await expect(page.getByText("Added 1 deck to your family's private decks.")).toBeVisible();
    await expect(page.locator("article.deck", { hasText: deck })).toContainText("Private");

    await startDeck(page, deck);
    await playRound(page, PLANET_ANSWERS); // 50 points
    await expect(page.locator(".points-summary")).toContainText("All-time total 50");

    await sessionBar(page).getByRole("button", { name: "Switch profile" }).click();
    await expect(profileTile(page, kid)).toContainText("50 pts");
  });

  test("a profile can be renamed and deleted", async ({ page, request }) => {
    const parent = unique("parent-");
    const kid = unique("Old");
    const renamed = unique("New");
    await asParent(request, parent).createProfile(kid);
    await signInParent(page, parent);

    await page.getByRole("button", { name: "Manage profiles" }).click();
    await page.getByRole("button", { name: `Edit ${kid}` }).click();
    await page.getByLabel("Nickname", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".manage__item", { hasText: renamed })).toContainText("Grade not set");

    await page.getByRole("button", { name: `Edit ${renamed}` }).click();
    acceptNextDialog(page, `Delete ${renamed}'s profile? Their points will be removed.`);
    await page.getByRole("button", { name: "Delete profile" }).click();
    await expect(page.locator(".manage__item", { hasText: renamed })).toHaveCount(0);

    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByText("No kid profiles yet.")).toBeVisible();
  });

  test("cancelling the delete keeps the profile", async ({ page, request }) => {
    const parent = unique("parent-");
    const kid = unique("Stay");
    await asParent(request, parent).createProfile(kid);
    await signInParent(page, parent);
    await page.getByRole("button", { name: "Manage profiles" }).click();
    await page.getByRole("button", { name: `Edit ${kid}` }).click();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Delete profile" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".manage__item", { hasText: kid })).toBeVisible();
  });

  test("a nickname that isn't allowed is explained", async ({ page }) => {
    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "Add a profile" }).click();
    await page.getByLabel("Nickname", { exact: true }).fill("!!!");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.locator(".profile-form").getByRole("alert")).toBeVisible();
    await expect(page.locator(".manage__list .manage__item")).toHaveCount(0);
  });

  test("settings are saved and the theme applies right away", async ({ page }) => {
    const parent = unique("parent-");
    await signInParent(page, parent);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();

    await page.getByLabel("Your name").fill("Coach Kim");
    await page.getByLabel("Theme").selectOption("dark");
    await page.getByLabel("Card order").selectOption("off");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.getByText("Parent & teacher workspace · Coach Kim")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Card order")).toHaveValue("off");

    // Back to following the device.
    await page.getByLabel("Theme").selectOption("system");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  });

  test("the parent's card order setting overrides the deck's", async ({ page, request }) => {
    const parent = unique("parent-");
    const kid = unique("Order");
    const api = asParent(request, parent);
    const profile = await api.createProfile(kid);
    // A deck that asks to shuffle; the parent chose "Never shuffle", so the order stays as written.
    const title = unique("Ordered ");
    const yaml = deckYaml(title).replace('"shuffle": false', '"shuffle": true');
    await api.createDeck(title, [profile.id], yaml);
    const me = await request.patch("/api/me", { headers: api.headers, data: { settings: { theme: "system", shuffle: "off" } } });
    expect(me.ok()).toBe(true);

    await signInParent(page, parent);
    await profileTile(page, kid).click();
    await startDeck(page, title);
    // All four in the written order (a shuffle would almost never give this).
    for (const card of PLANETS) {
      await expect(page.locator("h2.question")).toHaveText(card.question);
      await answer(page, card.answer);
      await nextCard(page);
    }
    await expect(page.getByRole("heading", { name: "4 of 4 correct" })).toBeVisible();
  });

  test("deleting the account removes it and its profiles, and signs out", async ({ page, request }) => {
    const parent = unique("parent-");
    const api = asParent(request, parent);
    await api.createProfile(unique("Gone"));
    await signInParent(page, parent);

    await page.getByRole("button", { name: "Settings" }).click();
    const remove = page.getByRole("button", { name: "Delete my account" });
    await expect(remove).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("delete");
    await expect(remove).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await remove.click();

    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText("Your account and all its kid profiles were deleted.")).toBeVisible();
    // Signing in again starts from an empty account.
    const me = await (await request.get("/api/me", { headers: api.headers })).json();
    expect(me.profiles).toEqual([]);
  });

  test("signing out returns to the welcome screen and stays signed out", async ({ page }) => {
    await signInParent(page, unique("parent-"));
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
  });
});

test.describe("privacy between accounts", () => {
  test("one parent can't see or change another parent's profiles, decks or files", async ({ page, request }) => {
    const owner = asParent(request, unique("owner-"));
    const stranger = asParent(request, unique("stranger-"));
    const kid = await owner.createProfile(unique("Mine"));
    const deck = await owner.createDeck(unique("Secret "));

    // Through the app: the stranger sees an empty account.
    await signInParent(page, stranger.headers["x-dev-user"]);
    await expect(page.getByText("No kid profiles yet.")).toBeVisible();
    await page.getByRole("button", { name: "My decks" }).click();
    await expect(page.getByText("No decks yet.")).toBeVisible();

    // Directly through the API: every attempt is "not found".
    const as = { headers: stranger.headers };
    expect((await request.patch(`/api/profiles?id=${kid.id}`, { ...as, data: { nickname: "Hacked" } })).status()).toBe(404);
    expect((await request.delete(`/api/profiles?id=${kid.id}`, as)).status()).toBe(404);
    expect((await request.post("/api/session", { ...as, data: { profileId: kid.id } })).status()).toBe(404);
    expect((await request.post("/api/invites", { ...as, data: { profileId: kid.id } })).status()).toBe(404);
    expect((await request.patch(`/api/decks?id=${deck.id}`, { ...as, data: { enabled: false } })).status()).toBe(404);
    expect((await request.delete(`/api/decks?id=${deck.id}`, as)).status()).toBe(404);

    // And the owner's data is untouched.
    const mine = await (await request.get("/api/me", { headers: owner.headers })).json();
    expect(mine.profiles.map((p: { nickname: string }) => p.nickname)).toEqual([kid.nickname]);
  });
});
