// A kid's own device, linked to their profile with an invitation link (kids have no accounts).
import {
  acceptNextDialog,
  answer,
  asParent,
  expect,
  linkDevice,
  newDevice,
  PLANET_ANSWERS,
  playRound,
  serverSession,
  sessionBar,
  signInParent,
  startDeck,
  test,
  unique,
} from "./support";

const LINK_GONE = "This link has expired or was already used. Ask your parent for a new one.";

/** A parent with one kid (on the public leaderboard), a private deck for that kid, and an invitation token. */
async function family(request: Parameters<typeof asParent>[0]) {
  const parent = asParent(request, unique("parent-"));
  const kid = await parent.createProfile(unique("Kid"), true);
  const deck = unique("Homework ");
  await parent.createDeck(deck, [kid.id]);
  const token = await parent.createInvite(kid.id);
  return { parent, kid, deck, token };
}

test.describe("kid's own device", () => {
  test("links with the invitation link, studies a private deck and keeps the points @mobile", async ({ browser, request }) => {
    const { parent, kid, deck, token } = await family(request);
    const { page, context, errors } = await newDevice(browser);

    await page.goto(`/#join=${token}`);
    await expect(page.getByRole("heading", { name: `Study as ${kid.nickname}?` })).toBeVisible();
    // The secret is taken out of the address bar (and history) at once.
    expect(await page.evaluate(() => window.location.hash)).toBe("");

    await page.getByRole("button", { name: `Use this device as ${kid.nickname}` }).click();
    await expect(page.getByRole("heading", { name: `Welcome back, ${kid.nickname}.` })).toBeVisible();
    await expect(page.getByLabel("0 points so far")).toBeVisible();
    // Regression (PR #9, lost in the redesign): the kid's home screen shows the leaderboard too.
    await expect(page.getByRole("region", { name: /Leaderboard/ })).toBeVisible();

    await page.getByRole("button", { name: /Explore decks/ }).click();
    await expect(sessionBar(page)).toContainText(kid.nickname);
    await expect(page.locator("article.deck", { hasText: deck })).toContainText("Private");
    await startDeck(page, deck);
    await playRound(page, PLANET_ANSWERS); // 50 points
    await expect(page.locator(".points-summary")).toContainText("All-time total 50");

    await sessionBar(page).getByRole("button", { name: "Finish" }).click();
    await expect(page.getByLabel("50 points so far")).toBeVisible();
    const me = page.getByRole("region", { name: /Leaderboard/ }).locator(".leaderboard__row.is-you");
    await expect(me).toContainText(kid.nickname);

    // Still linked after a reload, and the parent sees the device.
    await page.reload();
    await expect(page.getByRole("heading", { name: `Welcome back, ${kid.nickname}.` })).toBeVisible();
    expect((await parent.devices()).filter((d) => d.profileId === kid.id)).toHaveLength(1);

    expect(errors).toEqual([]);
    await context.close();
  });

  test("the link works only once", async ({ browser, request }) => {
    const { kid, token } = await family(request);
    const first = await linkDevice(browser, token, kid.nickname);

    const second = await newDevice(browser);
    await second.page.goto(`/#join=${token}`);
    await expect(second.page.getByRole("alert")).toHaveText(LINK_GONE);
    await second.page.getByRole("button", { name: "OK" }).click();
    await expect(second.page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();

    await Promise.all([first.context.close(), second.context.close()]);
  });

  test("a new link replaces the old one", async ({ browser, request }) => {
    const { parent, kid, token: old } = await family(request);
    const fresh = await parent.createInvite(kid.id);

    const device = await newDevice(browser);
    await device.page.goto(`/#join=${old}`);
    await expect(device.page.getByRole("alert")).toHaveText(LINK_GONE);
    await device.page.goto("/");
    await device.page.goto(`/#join=${fresh}`);
    await expect(device.page.getByRole("button", { name: `Use this device as ${kid.nickname}` })).toBeVisible();
    await device.context.close();
  });

  test("an incomplete link is explained", async ({ browser }) => {
    const device = await newDevice(browser);
    await device.page.goto("/#join=abc123");
    await expect(device.page.getByRole("alert")).toHaveText("This link isn't complete. Ask your parent to send it again.");
    await device.context.close();
  });

  test("'Not now' leaves the device unlinked, and the link still works later", async ({ browser, request }) => {
    const { kid, token } = await family(request);
    const device = await newDevice(browser);
    await device.page.goto(`/#join=${token}`);
    await device.page.getByRole("button", { name: "Not now" }).click();
    await expect(device.page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();

    await device.page.goto("/");
    await device.page.goto(`/#join=${token}`);
    await device.page.getByRole("button", { name: `Use this device as ${kid.nickname}` }).click();
    await expect(device.page.getByRole("heading", { name: `Welcome back, ${kid.nickname}.` })).toBeVisible();
    await device.context.close();
  });

  test("the kid can remove the device themselves", async ({ browser, request }) => {
    const { parent, kid, token } = await family(request);
    const { page, context } = await linkDevice(browser, token, kid.nickname);

    acceptNextDialog(page, `Remove this device from ${kid.nickname}'s profile?`);
    await page.getByRole("button", { name: `Not ${kid.nickname}? Remove this device` }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText("This device was removed. Ask your parent for a new link to study as yourself again.")).toBeVisible();
    expect((await parent.devices()).filter((d) => d.profileId === kid.id)).toHaveLength(0);
    await context.close();
  });

  test("the parent sees the linked device and can remove it", async ({ browser, page, request }) => {
    const { parent, kid, token } = await family(request);
    const device = await linkDevice(browser, token, kid.nickname);
    const [linked] = await parent.devices();

    await signInParent(page, parent.headers["x-dev-user"]);
    await page.getByRole("button", { name: "Manage profiles" }).click();
    const row = page.locator(".manage__item", { hasText: kid.nickname });
    await expect(row).toContainText("1 device linked");
    await row.getByRole("button", { name: "Devices" }).click();
    await expect(row).toContainText(linked.label);
    acceptNextDialog(page, `Remove ${linked.label}? It will stop studying as ${kid.nickname}.`);
    await row.getByRole("button", { name: `Remove ${linked.label} from ${kid.nickname}'s devices` }).click();
    await expect(row).toContainText("No devices linked yet.");

    // The kid's device is back to the guest welcome.
    await device.page.reload();
    await expect(device.page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await device.context.close();
  });

  test("removed during a session: the kid is told at the next step", async ({ browser, request }) => {
    const { parent, kid, deck, token } = await family(request);
    const { page, context, errors } = await linkDevice(browser, token, kid.nickname);
    await page.getByRole("button", { name: /Explore decks/ }).click();
    await expect(page.locator("article.deck", { hasText: deck })).toBeVisible();

    const [linked] = await parent.devices();
    await parent.removeDevice(linked.id);

    await page.getByRole("button", { name: `Study ${deck}` }).click();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    await expect(page.getByText("This device is no longer linked. Ask an adult for a new link.")).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("removed in the middle of a round: the next answer is refused and the kid is told", async ({ browser, request }) => {
    const { parent, kid, deck, token } = await family(request);
    const { page, context, errors } = await linkDevice(browser, token, kid.nickname);
    await page.getByRole("button", { name: /Explore decks/ }).click();
    await startDeck(page, deck);
    await answer(page, "Mercury");
    await expect.poll(async () => (await serverSession(page))?.points).toBe(10);

    const [linked] = await parent.devices();
    await parent.removeDevice(linked.id);

    await page.getByRole("button", { name: /^Next question/ }).click();
    await page.locator(".options").getByRole("button", { name: "Mars", exact: true }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText(/This device is no longer linked\. Ask an adult for a new link\./)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("private decks on kids' devices", () => {
  test("each kid sees only the decks the parent picked for them, and only while switched on", async ({ browser, request }) => {
    const parent = asParent(request, unique("parent-"));
    const ana = await parent.createProfile(unique("Ana"));
    const ben = await parent.createProfile(unique("Ben"));
    const anasDeck = unique("Ana only ");
    const deck = await parent.createDeck(anasDeck, [ana.id]);

    const anaDevice = await linkDevice(browser, await parent.createInvite(ana.id), ana.nickname);
    const benDevice = await linkDevice(browser, await parent.createInvite(ben.id), ben.nickname);
    for (const d of [anaDevice, benDevice]) await d.page.getByRole("button", { name: /Explore decks/ }).click();

    await expect(anaDevice.page.getByRole("button", { name: `Study ${anasDeck}` })).toBeVisible();
    await expect(benDevice.page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
    await expect(benDevice.page.getByRole("button", { name: `Study ${anasDeck}` })).toHaveCount(0);

    // Switched off while Ana's list is open: opening it is refused and it leaves her list.
    await parent.updateDeck(deck.id, { enabled: false });
    await anaDevice.page.getByRole("button", { name: `Study ${anasDeck}` }).click();
    await expect(anaDevice.page.getByRole("alert")).toContainText("This deck couldn't be opened.");
    await expect(anaDevice.page.getByRole("button", { name: `Study ${anasDeck}` })).toHaveCount(0);
    await expect(sessionBar(anaDevice.page)).toContainText(ana.nickname); // still studying

    await Promise.all([anaDevice.context.close(), benDevice.context.close()]);
  });
});
