import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";
import { parseDeck } from "../src/deck.js";
import { createProfile, deleteProfile } from "./account-handlers.js";
import { getAccountsDb, MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import type { Deps } from "./deps.js";
import { startSession, submitScore, getSession } from "./handlers.js";
import { createInvite, deleteKid, postKid } from "./kid-handlers.js";
import { createDeck, updateDeck } from "./library-handlers.js";
import { MemoryStore, RedisStore } from "./store.js";

const yaml = "title: Stars\nenabled: true\ncards:\n  - question: Star?\n    options: [Sun, Moon]\n    answer: Sun\n";
const request = (path: string, options: { body?: unknown; user?: string; cookie?: string; method?: string } = {}) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.user) headers.set(DevAuthenticator.HEADER, options.user);
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(`https://test.invalid${path}`, { method: options.method ?? "POST", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
};
const cookie = (response: Response) => response.headers.get("set-cookie")!.split(";")[0];

async function exercise(deps: Deps, cleanup: (accountIds: string[], playerIds: string[], sessionIds: string[], batchIds: string[]) => Promise<void>) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const owner = `phase2-${suffix}`;
  const stranger = `phase2b-${suffix}`;
  const accounts = [`dev_${owner}`, `dev_${stranger}`];
  const players: string[] = [];
  const sessions: string[] = [];
  const batches = ["dup", "private", "guest-replay", "precommit", "parent"];
  let now = Date.now();
  deps.now = () => now;
  try {
    expect(parseDeck(yaml, "Stars").ok).toBe(true);
    expect(parseDeck(yaml.replace("options: [Sun, Moon]", "options: [Sun, Sun]"), "Stars").ok).toBe(false);
    const created = await createProfile(request("/api/profiles", { user: owner, body: { nickname: "Nova" } }), deps);
    expect(created.status).toBe(201);
    const profile = (await created.json()).profile as { id: string };
    players.push(`p:${profile.id}`);
    const made = await createDeck(request("/api/decks", { user: owner, body: { yaml } }), deps);
    expect(made.status).toBe(201);
    const deck = (await made.json()).deck as { id: string };
    const alien = await createDeck(request("/api/decks", { user: stranger, body: { yaml } }), deps);
    expect(alien.status).toBe(201);
    const alienDeck = (await alien.json()).deck as { id: string };
    const invite = await createInvite(request("/api/invites", { user: owner, body: { profileId: profile.id } }), deps);
    expect(invite.status).toBe(201);
    const token = (await invite.json()).token as string;
    const joined = await postKid(request("/api/kid", { body: { action: "join", token } }), deps);
    expect(joined.status).toBe(201);
    const device = cookie(joined);
    const start = await startSession(request("/api/session", { cookie: device, body: { kid: true } }), deps);
    expect(start.status).toBe(201);
    const sessionCookie = cookie(start);
    sessions.push(decodeURIComponent(sessionCookie.split("=")[1]));
    const combined = `${device}; ${sessionCookie}`;
    const score = (deckId: string, batchId: string, answers: boolean[]) => submitScore(request("/api/score", { cookie: combined, body: { deckId, batchId, answers, leaderboard: false } }), deps);
    const [a, b] = await Promise.all([score(deck.id, "dup", [true]), score(deck.id, "dup", [true])]);
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect((await score(deck.id, "dup", [false])).status).toBe(409);
    expect((await score(alienDeck.id, "private", [true])).status).toBe(403);
    expect((await getSession(request(`/api/session?deckId=${deck.id}`, { method: "GET", cookie: combined }), deps)).status).toBe(200);
    expect((await updateDeck(request(`/api/decks?id=${deck.id}`, { method: "PATCH", user: owner, body: { profileIds: [] } }), deps)).status).toBe(200);
    expect((await score(deck.id, "private", [true])).status).toBe(403);
    expect((await updateDeck(request(`/api/decks?id=${deck.id}`, { method: "PATCH", user: owner, body: { enabled: false } }), deps)).status).toBe(200);
    expect((await score(deck.id, "private", [true])).status).toBe(403);
    expect((await deleteKid(request("/api/kid", { method: "DELETE", cookie: device }), deps)).status).toBe(200);
    expect((await score(deck.id, "private", [true])).status).toBe(403);
    expect((await deleteProfile(request(`/api/profiles?id=${profile.id}`, { method: "DELETE", user: owner }), deps)).status).toBe(200);
    const second = await createProfile(request("/api/profiles", { user: owner, body: { nickname: "Orbit" } }), deps);
    expect(second.status).toBe(201);
    const profile2 = (await second.json()).profile as { id: string };
    players.push(`p:${profile2.id}`);
    expect((await startSession(request("/api/session", { user: stranger, body: { profileId: profile2.id } }), deps)).status).toBe(404);
    const parentStart = await startSession(request("/api/session", { user: owner, body: { profileId: profile2.id } }), deps);
    expect(parentStart.status).toBe(201);
    const parentCookie = cookie(parentStart);
    sessions.push(decodeURIComponent(parentCookie.split("=")[1]));
    expect((await submitScore(request("/api/score", { cookie: parentCookie, body: { answers: [true], batchId: "parent", leaderboard: false } }), deps)).status).toBe(200);
    const secondInvite = await createInvite(request("/api/invites", { user: owner, body: { profileId: profile2.id } }), deps);
    expect(secondInvite.status).toBe(201);
    const secondToken = (await secondInvite.json()).token as string;
    const secondJoin = await postKid(request("/api/kid", { body: { action: "join", token: secondToken } }), deps);
    expect(secondJoin.status).toBe(201);
    const secondDevice = cookie(secondJoin);
    const secondStart = await startSession(request("/api/session", { cookie: secondDevice, body: { kid: true } }), deps);
    expect(secondStart.status).toBe(201);
    const secondSession = cookie(secondStart);
    sessions.push(decodeURIComponent(secondSession.split("=")[1]));
    expect((await deleteProfile(request(`/api/profiles?id=${profile2.id}`, { method: "DELETE", user: owner }), deps)).status).toBe(200);
    expect((await getSession(request("/api/session", { method: "GET", cookie: `${secondDevice}; ${secondSession}` }), deps)).status).toBe(403);
    const guestName = `Test${suffix}`;
    players.push(guestName.toLowerCase());
    const guestStart = await startSession(request("/api/session", { body: { name: guestName } }), deps);
    expect(guestStart.status).toBe(201);
    const guest = cookie(guestStart);
    sessions.push(decodeURIComponent(guest.split("=")[1]));
    const guestScore = (body: unknown) => submitScore(request("/api/score", { cookie: guest, body }), deps);
    expect((await guestScore({ answers: [true], leaderboard: false })).status).toBe(200); // legacy caller
    expect((await guestScore({ answers: ["true"], batchId: "guest-replay", leaderboard: false })).status).toBe(400);
    const originalStore = deps.store!;
    let injectFailure = true;
    const faultStore = new Proxy(originalStore, { get(target, key) {
      if (key === "addScoreBatch") return (...args: Parameters<typeof target.addScoreBatch>) => {
        if (injectFailure) { injectFailure = false; throw new Error("injected pre-commit failure"); }
        return target.addScoreBatch(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const faultPayload = { answers: [false], batchId: "precommit", leaderboard: false };
    await expect(submitScore(request("/api/score", { cookie: guest, body: faultPayload }), { ...deps, store: faultStore })).rejects.toThrow("injected pre-commit failure");
    expect((await guestScore(faultPayload)).status).toBe(200);
    const payload = { answers: [true], batchId: "guest-replay", leaderboard: false };
    const committed = await guestScore(payload); // simulate losing the first response
    expect(committed.status).toBe(200);
    const retried = await guestScore(payload);
    expect(await retried.json()).toEqual(await committed.json());
    expect(await (await getSession(request("/api/session", { method: "GET", cookie: guest }), deps)).json()).toMatchObject({ points: 20 });
    now += 3601_000;
    const expired = await getSession(request("/api/session", { method: "GET", cookie: sessionCookie }), deps);
    expect(expired.status).toBe(200);
    expect(await expired.json()).toBeNull();
    expect((await guestScore({ answers: [true], batchId: "guest-replay", leaderboard: false })).status).toBe(401);
  } finally {
    await cleanup(accounts, players, sessions, batches);
  }
}

describe("phase 2 service-backed foundation smoke", () => {
  it("runs the cross-store scenario in memory", async () => {
    const accounts = new MemoryAccounts();
    const store = new MemoryStore();
    await exercise({ accounts, store, auth: new DevAuthenticator(), now: Date.now, newId: randomUUID }, async () => {});
  });

  it.skipIf(process.env.QUIZZLET_PHASE2_RUN !== "1")("runs against explicitly isolated Neon and Upstash transports", async () => {
    if (process.env.QUIZZLET_PHASE2_ISOLATED !== "YES") throw new Error("Set QUIZZLET_PHASE2_ISOLATED=YES only for dedicated disposable test services.");
    const url = process.env.QUIZZLET_PHASE2_NEON_URL;
    const redisUrl = process.env.QUIZZLET_PHASE2_UPSTASH_URL;
    const token = process.env.QUIZZLET_PHASE2_UPSTASH_TOKEN;
    if (!url || !redisUrl || !token) throw new Error("Dedicated Phase 2 service settings are incomplete.");
    const accounts = getAccountsDb({ DATABASE_URL: url });
    if (!accounts) throw new Error("Cannot initialize test database.");
    const redis = new Redis({ url: redisUrl, token });
    const store = new RedisStore(redis);
    await exercise({ accounts, store, auth: new DevAuthenticator(), now: Date.now, newId: randomUUID }, async (accountIds, playerIds, sessionIds, batchIds) => {
      const receipts = sessionIds.flatMap((id) => batchIds.map((batch) => `score-receipt:${id}:${batch}`));
      const operations = [
        ...playerIds.map((id) => store.removePlayer(id)),
        ...sessionIds.map((id) => store.deleteSession(id)),
        ...(receipts.length ? [redis.del(...receipts)] : []),
        ...accountIds.map((id) => accounts.forAccount(id).remove()),
      ];
      const results = await Promise.allSettled(operations);
      if (results.some((result) => result.status === "rejected")) throw new Error("Test cleanup was incomplete; inspect the dedicated test services.");
    });
  }, 60000);
});
