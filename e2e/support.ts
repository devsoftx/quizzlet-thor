// Shared helpers for the end-to-end tests.
//
// The test server keeps everything in memory for the whole run and tests run in
// parallel, so every test makes its own names (unique()) and never relies on
// what other tests created: guests, parents and kid profiles are all fresh.
import { expect, test as base, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export { expect };

/**
 * Fails a test when the page throws an uncaught error or breaks the content
 * security policy, on top of its own checks.
 */
export const test = base.extend<{ failOnPageErrors: void }>({
  failOnPageErrors: [
    async ({ page }, use) => {
      const errors = watchPageErrors(page);
      await use();
      expect(errors, "uncaught errors or content-policy violations in the page").toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * Collects a page's uncaught errors, and anything it did that the content
 * security policy doesn't allow. Most of the policy is report-only for now
 * (see vercel.json), so the browser only reports a violation; here that fails
 * the test, which keeps the policy matching what the app really loads.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

// A unique nickname, id or title that the app's nickname rules always accept (see unique.ts).
export { unique } from "./unique";

// ------------------------------------------------------------------ Decks

export interface TestCard {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
}

/** A small deck with known answers, always in this order. */
export const PLANETS: TestCard[] = [
  {
    question: "Which planet is closest to the Sun?",
    options: ["Mercury", "Venus", "Mars", "Earth"],
    answer: "Mercury",
    explanation: "Mercury orbits closest to the Sun.",
  },
  { question: "Which planet is known as the Red Planet?", options: ["Jupiter", "Mars", "Saturn", "Neptune"], answer: "Mars" },
  { question: "What is the largest planet?", options: ["Earth", "Uranus", "Jupiter", "Venus"], answer: "Jupiter" },
  {
    question: "Which planet has the most famous rings?",
    options: ["Saturn", "Mercury", "Mars", "Earth"],
    answer: "Saturn",
    explanation: "Saturn's rings are made mostly of ice.",
  },
];

/** The right answers to PLANETS, in order. */
export const PLANET_ANSWERS = PLANETS.map((c) => c.answer);

interface DeckOptions {
  cards?: TestCard[];
  enabled?: boolean;
  subject?: string;
  description?: string;
}

/** A deck file. JSON is valid YAML, so this is a deck file the app accepts as is. */
export function deckYaml(title: string, options: DeckOptions = {}): string {
  return JSON.stringify(
    {
      title,
      description: options.description ?? "A deck made by the end-to-end tests.",
      enabled: options.enabled ?? true,
      shuffle: false,
      shuffleOptions: false,
      ...(options.subject ? { subject: options.subject } : {}),
      cards: options.cards ?? PLANETS,
    },
    null,
    2,
  );
}

/** A deck file that fails validation: the answer isn't one of the options. */
export function brokenDeckYaml(title: string): string {
  return deckYaml(title, { cards: [{ question: "Which is a dwarf planet?", options: ["Earth", "Mars"], answer: "Pluto" }] });
}

export const fileName = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.yaml`;

// ------------------------------------------------------------------ Guest

export async function startGuest(page: Page, name: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Your nickname").fill(name);
  await page.getByRole("button", { name: /Start exploring/ }).click();
  await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
}

/** Imports a deck file from the deck list (into this browser, or a parent's account during a kid's session). */
export async function importDeck(page: Page, title: string, yaml = deckYaml(title)): Promise<void> {
  await page.locator('input[type="file"][accept=".yaml,.yml"]').setInputFiles({
    name: fileName(title),
    mimeType: "text/yaml",
    buffer: Buffer.from(yaml),
  });
}

/** From the deck list: open a deck's preview and start practising. */
export async function startDeck(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Study ${title}` }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Start practice/ }).click();
  await expect(page.getByText("Take a moment to think")).toBeVisible();
}

/** The button that checks the chosen answer, in either language. */
export const checkButton = (page: Page) => page.getByRole("button", { name: /^(Check answer|Comprobar respuesta)$/ });

/** Chooses an answer on the current card, checks it, and waits for the feedback. */
export async function answer(page: Page, option: string): Promise<void> {
  await page.locator(".options").getByRole("button", { name: option, exact: true }).click();
  await checkButton(page).click();
  await expect(page.locator(".field-feedback")).toBeVisible();
}

export async function nextCard(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Next question|See results)/ }).click();
}

/** Answers every card of a round in order, ending on the results screen. */
export async function playRound(page: Page, picks: string[]): Promise<void> {
  for (const pick of picks) {
    await answer(page, pick);
    await nextCard(page);
  }
  await expect(page.getByRole("heading", { name: /of \d+ correct/ })).toBeVisible();
}

/** The session as the server sees it (or null), using this browser's cookies. */
export async function serverSession(page: Page): Promise<{ name: string; points: number; profileId: string | null } | null> {
  const res = await page.request.get("/api/session");
  expect(res.status()).toBe(200);
  return res.json();
}

/** The session bar at the top of the app. */
export const sessionBar = (page: Page) => page.getByLabel("Your session");

/** Accepts the next confirm() dialog, checking its text. */
export function acceptNextDialog(page: Page, text: string | RegExp): void {
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toMatch(text);
    await dialog.accept();
  });
}

// ------------------------------------------------------------------ Parents

/** Signs in with the local sign-in stand-in (the test server never uses real sign-in). */
export async function signInParent(page: Page, parentId: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Parent or teacher sign in" }).click();
  const dialog = page.getByRole("dialog", { name: "Local test sign-in" });
  await dialog.getByLabel("Parent test ID").fill(parentId);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Who's exploring today?" })).toBeVisible();
}

/** A kid's tile on the parent's home ("Study as <nickname>", then their points). */
export const profileTile = (page: Page, nickname: string) =>
  page.getByRole("button", { name: new RegExp(`^Study as ${nickname}\\b`) });

export interface Profile {
  id: string;
  nickname: string;
}

/** Quick setup through the API as a signed-in parent (the UI flows have their own tests). */
export function asParent(request: APIRequestContext, parentId: string) {
  const headers = { "x-dev-user": parentId };
  async function ok<T>(res: Promise<import("@playwright/test").APIResponse>): Promise<T> {
    const r = await res;
    expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text()}`).toBe(true);
    return r.json() as Promise<T>;
  }
  return {
    headers,
    async createProfile(nickname: string, showOnLeaderboard = false): Promise<Profile> {
      const body = { nickname, gradeBand: null, color: "#4255ff", emoji: "🦊", showOnLeaderboard };
      return (await ok<{ profile: Profile }>(request.post("/api/profiles", { headers, data: body }))).profile;
    },
    async createInvite(profileId: string): Promise<string> {
      return (await ok<{ token: string }>(request.post("/api/invites", { headers, data: { profileId } }))).token;
    },
    async createDeck(title: string, profileIds: string[] | null = null, yaml = deckYaml(title)): Promise<{ id: string }> {
      const data = { fileName: fileName(title), yaml, profileIds };
      return (await ok<{ deck: { id: string } }>(request.post("/api/decks", { headers, data }))).deck;
    },
    async updateDeck(id: string, patch: { enabled?: boolean; profileIds?: string[] | null }): Promise<void> {
      await ok(request.patch(`/api/decks?id=${id}`, { headers, data: patch }));
    },
    async devices(): Promise<Array<{ id: string; profileId: string; label: string }>> {
      return (await ok<{ devices: Array<{ id: string; profileId: string; label: string }> }>(request.get("/api/invites", { headers }))).devices;
    },
    async removeDevice(deviceId: string): Promise<void> {
      await ok(request.delete(`/api/invites?deviceId=${deviceId}`, { headers }));
    },
  };
}

/**
 * As a signed-in parent: studies a deck as one of their kids, then switches
 * back to the parent's home. `round` is each card's picks in order (the last
 * one is checked; earlier ones are changes of mind).
 */
export async function studyAsKid(page: Page, nickname: string, deckTitle: string, round: string[][]): Promise<void> {
  await profileTile(page, nickname).click();
  await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  await startDeck(page, deckTitle);
  for (const picks of round) {
    for (const pick of picks.slice(0, -1)) await page.locator(".options").getByRole("button", { name: pick, exact: true }).click();
    await answer(page, picks.at(-1)!);
    await nextCard(page);
  }
}

// ------------------------------------------------------------------ Kid devices

/** A separate browser, like a kid's own tablet: no cookies shared with the parent's. */
export async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  // The same kind of screen as the test's project (desktop or phone).
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const page = await context.newPage();
  return { context, page, errors: watchPageErrors(page) };
}

/** Links a new device to a kid's profile with an invitation token, ending on the kid's home screen. */
export async function linkDevice(browser: Browser, token: string, nickname: string) {
  const device = await newDevice(browser);
  await device.page.goto(`/#join=${token}`);
  await device.page.getByRole("button", { name: `Use this device as ${nickname}` }).click();
  await expect(device.page.getByRole("heading", { name: `Welcome back, ${nickname}.` })).toBeVisible();
  return device;
}
