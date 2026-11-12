import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createProfile,
  deleteMe,
  deleteProfile,
  getMe,
  listProfiles,
  updateMe,
  updateProfile,
} from "./account-handlers.js";
import { MemoryAccounts } from "./accounts.js";
import { DevAuthenticator, authorizedParties } from "./auth.js";
import type { Deps } from "./deps.js";
import { cleanName, getLeaderboard, startSession, submitScore } from "./handlers.js";
import { MemoryStore } from "./store.js";

const BASE = "https://quizzlet.test";

class TestAuth extends DevAuthenticator {
  deleted: string[] = [];
  override async deleteUser(userId: string) {
    this.deleted.push(userId);
  }
}

function setup() {
  let ids = 0;
  const auth = new TestAuth();
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth,
    now: () => Date.UTC(2026, 10, 12, 12),
    newId: () => `id-${++ids}`,
  };
  return { deps, auth };
}

function req(
  path: string,
  init: { method?: string; body?: unknown; user?: string; cookie?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

async function newProfile(deps: Deps, user: string, body: Record<string, unknown>) {
  const res = await createProfile(req("/api/profiles", { method: "POST", body, user }), deps);
  expect(res.status).toBe(201);
  return (await res.json()).profile as { id: string; nickname: string; showOnLeaderboard: boolean };
}

describe("account routes need a signed-in parent", () => {
  const routes = [
    () => getMe(req("/api/me"), setup().deps),
    () => updateMe(req("/api/me", { method: "PATCH", body: {} }), setup().deps),
    () => deleteMe(req("/api/me", { method: "DELETE", body: { confirm: true } }), setup().deps),
    () => listProfiles(req("/api/profiles"), setup().deps),
    () => createProfile(req("/api/profiles", { method: "POST", body: { nickname: "Nova" } }), setup().deps),
    () => updateProfile(req("/api/profiles?id=x", { method: "PATCH", body: {} }), setup().deps),
    () => deleteProfile(req("/api/profiles?id=x", { method: "DELETE" }), setup().deps),
    () => startSession(req("/api/session", { method: "POST", body: { profileId: "x" } }), setup().deps),
  ];

  it("returns 401 without a sign-in", async () => {
    for (const call of routes) expect((await call()).status).toBe(401);
  });

  it("returns 503 when accounts aren't configured", async () => {
    const deps: Deps = { ...setup().deps, auth: null };
    expect((await getMe(req("/api/me", { user: "a" }), deps)).status).toBe(503);
    const noDb: Deps = { ...setup().deps, accounts: null };
    expect((await listProfiles(req("/api/profiles", { user: "a" }), noDb)).status).toBe(503);
  });
});

describe("account and settings", () => {
  it("creates the account on first visit and saves settings", async () => {
    const { deps } = setup();
    const first = await (await getMe(req("/api/me", { user: "ana" }), deps)).json();
    expect(first).toMatchObject({ account: { displayName: "ana", plan: "free", settings: { theme: "system", shuffle: "deck" } }, profiles: [] });

    const res = await updateMe(
      req("/api/me", { method: "PATCH", user: "ana", body: { displayName: "Ana R", settings: { theme: "dark", bogus: 1 } } }),
      deps,
    );
    expect((await res.json()).account).toEqual({ displayName: "Ana R", plan: "free", settings: { theme: "dark", shuffle: "deck" } });

    const bad = await updateMe(req("/api/me", { method: "PATCH", user: "ana", body: { displayName: "<b>" } }), deps);
    expect(bad.status).toBe(400);
  });
});

describe("kid profiles", () => {
  it("creates nickname-only profiles that stay off the leaderboard by default", async () => {
    const { deps } = setup();
    const p = await newProfile(deps, "ana", { nickname: "Nova7", gradeBand: "3-5" });
    expect(p).toMatchObject({ nickname: "Nova7", showOnLeaderboard: false });

    for (const body of [{ nickname: "" }, { nickname: "Ok", gradeBand: "college" }, { nickname: "Ok", emoji: "💣" }]) {
      const res = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body }), deps);
      expect(res.status).toBe(400);
    }
  });

  it("caps profiles per account", async () => {
    const { deps } = setup();
    for (let i = 0; i < 20; i++) await newProfile(deps, "ana", { nickname: `Kid ${i}` });
    const res = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "One more" } }), deps);
    expect(res.status).toBe(400);
  });
});

describe("isolation between accounts", () => {
  it("never lets parent B see or change parent A's profiles", async () => {
    const { deps } = setup();
    const kid = await newProfile(deps, "parent-a", { nickname: "Nova7" });

    const listB = await (await listProfiles(req("/api/profiles", { user: "parent-b" }), deps)).json();
    expect(listB.profiles).toEqual([]);
    const meB = await (await getMe(req("/api/me", { user: "parent-b" }), deps)).json();
    expect(meB.profiles).toEqual([]);

    const patch = await updateProfile(
      req(`/api/profiles?id=${kid.id}`, { method: "PATCH", user: "parent-b", body: { nickname: "Hacked" } }),
      deps,
    );
    expect(patch.status).toBe(404);
    const del = await deleteProfile(req(`/api/profiles?id=${kid.id}`, { method: "DELETE", user: "parent-b" }), deps);
    expect(del.status).toBe(404);
    const session = await startSession(req("/api/session", { method: "POST", user: "parent-b", body: { profileId: kid.id } }), deps);
    expect(session.status).toBe(404);

    const listA = await (await listProfiles(req("/api/profiles", { user: "parent-a" }), deps)).json();
    expect(listA.profiles).toMatchObject([{ id: kid.id, nickname: "Nova7" }]);
  });
});

describe("kid sessions and the leaderboard", () => {
  it("plays as a profile and follows the parent's leaderboard choice", async () => {
    const { deps } = setup();
    const kid = await newProfile(deps, "ana", { nickname: "Nova7" });

    const start = await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId: kid.id } }), deps);
    expect(start.status).toBe(201);
    expect(await start.json()).toMatchObject({ name: "Nova7", profileId: kid.id });
    const cookie = cookieFrom(start);

    // Hidden by default: points count, but the board doesn't show the kid.
    const first = await (await submitScore(req("/api/score", { method: "POST", cookie, body: { answers: [true] } }), deps)).json();
    expect(first).toMatchObject({ pointsEarned: 10, totalPoints: 10, leaderboard: { top: [], you: null } });

    // Parent opts in: the kid appears with their whole total.
    await updateProfile(req(`/api/profiles?id=${kid.id}`, { method: "PATCH", user: "ana", body: { showOnLeaderboard: true } }), deps);
    const board = await (await getLeaderboard(req("/api/leaderboard", { cookie }), deps)).json();
    expect(board.top).toEqual([{ rank: 1, name: "Nova7", points: 10 }]);

    // Parent opts out mid-session: later points still don't put the kid back on the board.
    await updateProfile(req(`/api/profiles?id=${kid.id}`, { method: "PATCH", user: "ana", body: { showOnLeaderboard: false } }), deps);
    const later = await (await submitScore(req("/api/score", { method: "POST", cookie, body: { answers: [true] } }), deps)).json();
    expect(later).toMatchObject({ totalPoints: 20, leaderboard: { top: [] } });
  });

  it("keeps guest names and profile keys apart", () => {
    expect(cleanName("p:abc")).toBeNull();
  });
});

describe("deleting an account", () => {
  it("removes profiles, leaderboard entries and the sign-in", async () => {
    const { deps, auth } = setup();
    const kid = await newProfile(deps, "ana", { nickname: "Nova7", showOnLeaderboard: true });
    const cookie = cookieFrom(await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId: kid.id } }), deps));
    await submitScore(req("/api/score", { method: "POST", cookie, body: { answers: [true, true] } }), deps);
    expect((await (await getLeaderboard(req("/api/leaderboard"), deps)).json()).top).toHaveLength(1);

    expect((await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: {} }), deps)).status).toBe(400);
    const res = await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), deps);
    expect(await res.json()).toEqual({ ok: true, deletedProfiles: 1 });
    expect(auth.deleted).toEqual(["dev_ana"]);
    expect((await (await getLeaderboard(req("/api/leaderboard"), deps)).json()).top).toEqual([]);
    expect((await (await getMe(req("/api/me", { user: "ana" }), deps)).json()).profiles).toEqual([]);
  });
});

describe("sign-in configuration", () => {
  it("allows only this site's origins (plus localhost off Vercel)", () => {
    expect(authorizedParties({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "quizzlet-thor.vercel.app", VERCEL_URL: "quizzlet-thor-abc.vercel.app" })).toEqual([
      "https://quizzlet-thor.vercel.app",
      "https://quizzlet-thor-abc.vercel.app",
    ]);
    expect(authorizedParties({})).toContain("http://localhost:5173");
  });

  it("only uses the dev stand-in off Vercel", async () => {
    const { getAuthenticator } = await import("./auth.js");
    expect(getAuthenticator({ QUIZZLET_DEV_AUTH: "1" })).toBeInstanceOf(DevAuthenticator);
    expect(getAuthenticator({ QUIZZLET_DEV_AUTH: "1", VERCEL: "1" })).toBeNull();
    expect(getAuthenticator({})).toBeNull();
  });
});

describe("route guard", () => {
  // Every Vercel Function must be listed here, so a new route can't skip the sign-in check by accident.
  const PUBLIC = ["leaderboard.ts", "score.ts", "session.ts"]; // session.ts requires sign-in for profile sessions
  const SIGNED_IN = ["me.ts", "profiles.ts"];

  it("classifies every api/ route", () => {
    const files = readdirSync(new URL("../api/", import.meta.url)).filter((f) => f.endsWith(".ts")).sort();
    expect(files).toEqual([...PUBLIC, ...SIGNED_IN].sort());
  });
});
