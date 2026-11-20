// A kid's answers for the parent's Progress page: sent with the score batches,
// stored only for kid profiles, and read back only by the profile's parent.
import { afterEach, describe, expect, it } from "vitest";
import { cardKey, type AttemptDetail, type ProgressData } from "../src/attempts.js";
import { createProfile } from "./account-handlers.js";
import { MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import { runCleanup } from "./cron-handlers.js";
import type { Deps } from "./deps.js";
import { startSession } from "./handlers.js";
import { getProgress } from "./progress-handlers.js";
import { MemoryStore } from "./store.js";
import { captureLog, playing, score, type Playing } from "./test-support.js";

const BASE = "https://localhost";
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  let ids = 0;
  let now = Date.UTC(2026, 10, 12, 12);
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new DevAuthenticator(),
    now: () => now,
    newId: () => `id-${++ids}`,
    cronSecret: "cron-test-secret",
  };
  return { deps, later: (ms: number) => (now += ms) };
}

function req(path: string, init: { method?: string; body?: unknown; user?: string; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function kidSession(deps: Deps, parent: string): Promise<{ kidId: string; who: Playing }> {
  const res = await createProfile(req("/api/profiles", { method: "POST", user: parent, body: { nickname: "Nova7" } }), deps);
  const kidId = ((await res.json()) as { profile: { id: string } }).profile.id;
  const who = await playing(await startSession(req("/api/session", { method: "POST", user: parent, body: { profileId: kidId } }), deps));
  return { kidId, who };
}

const detail = (question: string, picks: number[], patch: Partial<AttemptDetail> = {}): AttemptDetail => ({
  deckKey: "bundled:planets.yaml",
  deckTitle: "Planets",
  cardKey: cardKey({ question, answer: "Mercury" }),
  question,
  difficulty: "easy",
  ms: 5200,
  picks,
  answerIndex: 0,
  optionCount: 4,
  retry: false,
  ...patch,
});

async function progress(deps: Deps, user: string | undefined, query: string) {
  return getProgress(req(`/api/progress?${query}`, { user }), deps);
}

let log: ReturnType<typeof captureLog> | null = null;
afterEach(() => log?.restore());

describe("recording a kid's answers", () => {
  it("stores a kid profile's details and serves them to the parent", async () => {
    const { deps } = setup();
    const { kidId, who } = await kidSession(deps, "ana");
    const res = await score(deps, who, { answers: [true, false], details: [detail("Closest to the Sun?", [2, 0]), detail("Red planet?", [1], { difficulty: "hard", retry: true })] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pointsEarned: 10 });

    const page = await progress(deps, "ana", `profileId=${kidId}&days=7`);
    expect(page.status).toBe(200);
    const data = (await page.json()) as ProgressData;
    expect(data).toMatchObject({ profileId: kidId, days: 7, truncated: false });
    expect(data.cards.map((c) => [c.question, c.difficulty])).toEqual([
      ["Closest to the Sun?", "easy"],
      ["Red planet?", "hard"],
    ]);
    expect(data.attempts.map((a) => [a.card, a.correct, a.picks, a.ms, a.retry])).toEqual([
      [0, true, [2, 0], 5200, false],
      [1, false, [1], 5200, true],
    ]);
  });

  it("stores a batch sent again only once", async () => {
    const { deps } = setup();
    const { kidId, who } = await kidSession(deps, "ana");
    const body = { batchId: "same-batch", answers: [true], details: [detail("Q?", [0])] };
    expect((await score(deps, who, body)).status).toBe(200);
    expect((await score(deps, who, body)).status).toBe(200); // a replay: the same receipt, nothing new
    const data = (await (await progress(deps, "ana", `profileId=${kidId}`)).json()) as ProgressData;
    expect(data.attempts).toHaveLength(1);
  });

  it("never stores a guest's answers", async () => {
    const { deps } = setup();
    const guest = await playing(await startSession(req("/api/session", { method: "POST", body: { name: "Comet" } }), deps));
    expect((await score(deps, guest, { answers: [true], details: [detail("Q?", [0])] })).status).toBe(200);
    expect(await deps.accounts!.pruneAttempts("9999-12-31T00:00:00.000Z")).toBe(0); // nothing was stored at all
  });

  it("saves the points but drops details that don't add up, and logs it", async () => {
    const { deps } = setup();
    const { kidId, who } = await kidSession(deps, "ana");
    log = captureLog();
    // The last pick isn't the answer, yet the answer was right.
    const wrongPicks = await score(deps, who, { answers: [true], details: [detail("Q?", [2])] });
    // A private deck's answers must come with that deck (checked for access).
    const otherDeck = await score(deps, who, { answers: [true], details: [detail("Q?", [0], { deckKey: "account:someone-elses" })] });
    expect([wrongPicks.status, otherDeck.status]).toEqual([200, 200]);
    expect((await otherDeck.json()) as { sessionPoints: number }).toMatchObject({ sessionPoints: 20 });
    expect(log.named("progress.refused").map((e) => e.reason)).toEqual(["picks disagree with the answer", "deck"]);
    expect(log.lines.join("\n")).not.toContain("Nova7");
    const data = (await (await progress(deps, "ana", `profileId=${kidId}`)).json()) as ProgressData;
    expect(data.attempts).toEqual([]);
  });

  it("is deleted by the daily cleanup after 180 days", async () => {
    const { deps, later } = setup();
    const { kidId, who } = await kidSession(deps, "ana");
    await score(deps, who, { answers: [true], details: [detail("Old?", [0])] });
    later(181 * DAY);
    const next = await playing(await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId: kidId } }), deps));
    await score(deps, next, { answers: [false], details: [detail("New?", [1])] });

    const cron = await runCleanup(new Request(`${BASE}/api/cron`, { headers: { authorization: "Bearer cron-test-secret" } }), deps);
    expect(await cron.json()).toMatchObject({ ok: true, progress: { removed: 1 } });
    const data = (await (await progress(deps, "ana", `profileId=${kidId}&days=180`)).json()) as ProgressData;
    expect(data.cards.map((c) => c.question)).toEqual(["New?"]);
  });
});

describe("GET /api/progress", () => {
  it("needs the profile's own parent, and one of the offered periods", async () => {
    const { deps } = setup();
    const { kidId } = await kidSession(deps, "ana");
    expect((await progress(deps, undefined, `profileId=${kidId}`)).status).toBe(401);
    expect((await progress(deps, "bea", `profileId=${kidId}`)).status).toBe(404); // another parent: as if it didn't exist
    expect((await progress(deps, "ana", "profileId=nope")).status).toBe(404);
    expect((await progress(deps, "ana", `profileId=${kidId}&days=365`)).status).toBe(400);
    expect((await progress(deps, "ana", `profileId=${kidId}&days=90`)).status).toBe(200);
  });

  it("covers only the period asked for", async () => {
    const { deps, later } = setup();
    const { kidId, who } = await kidSession(deps, "ana");
    await score(deps, who, { answers: [true], details: [detail("Early?", [0])] });
    later(10 * DAY);
    const again = await playing(await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId: kidId } }), deps));
    await score(deps, again, { answers: [true], details: [detail("Recent?", [0])] });
    const week = (await (await progress(deps, "ana", `profileId=${kidId}&days=7`)).json()) as ProgressData;
    const month = (await (await progress(deps, "ana", `profileId=${kidId}&days=30`)).json()) as ProgressData;
    expect(week.cards.map((c) => c.question)).toEqual(["Recent?"]);
    expect(month.cards.map((c) => c.question)).toEqual(["Early?", "Recent?"]);
  });
});
