import { describe, expect, it } from "vitest";
import { createProfile, deleteMe, deleteProfile, getMe, updateProfile } from "./account-handlers.js";
import { MAX_DEVICES_PER_PROFILE, MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import type { Deps } from "./deps.js";
import { getLeaderboard, startSession, submitScore } from "./handlers.js";
import { createInvite, deleteKid, deleteLink, deviceLabel, getKid, KID_COOKIE, listLinks, postKid } from "./kid-handlers.js";
import { createDeck, updateDeck } from "./library-handlers.js";
import { MemoryFileStore } from "./files.js";
import { MemoryStore } from "./store.js";

const BASE = "https://quizzlet.test";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DAY = 24 * 60 * 60 * 1000;

class TestAuth extends DevAuthenticator {
  override async deleteUser() {}
}

function setup() {
  let ids = 0;
  let now = Date.UTC(2026, 10, 15, 12);
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new TestAuth(),
    files: new MemoryFileStore(),
    now: () => now,
    newId: () => `id-${++ids}`,
  };
  return { deps, later: (ms: number) => (now += ms) };
}

function req(path: string, init: { method?: string; body?: unknown; user?: string; cookie?: string; ua?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.ua) headers.set("user-agent", init.ua);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

async function kid(deps: Deps, parent: string, nickname: string) {
  const res = await createProfile(req("/api/profiles", { method: "POST", user: parent, body: { nickname } }), deps);
  return (await res.json()).profile as { id: string };
}

async function invite(deps: Deps, parent: string, profileId: string) {
  const res = await createInvite(req("/api/invites", { method: "POST", user: parent, body: { profileId } }), deps);
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; invite: { profileId: string; expiresAt: string } };
}

const join = (deps: Deps, token: string, cookie?: string) =>
  postKid(req("/api/kid", { method: "POST", body: { action: "join", token }, ua: IPAD, cookie }), deps);

async function linkDevice(deps: Deps, parent: string, profileId: string) {
  const { token } = await invite(deps, parent, profileId);
  const res = await join(deps, token);
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

const whoAmI = async (deps: Deps, cookie?: string) => (await (await getKid(req("/api/kid", { cookie }), deps)).json()).kid;

describe("invitation links (parent side)", () => {
  it("need a signed-in parent", async () => {
    const { deps } = setup();
    expect((await listLinks(req("/api/invites"), deps)).status).toBe(401);
    expect((await createInvite(req("/api/invites", { method: "POST", body: { profileId: "x" } }), deps)).status).toBe(401);
    expect((await deleteLink(req("/api/invites?deviceId=x", { method: "DELETE" }), deps)).status).toBe(401);
  });

  it("makes a one-time link that expires in 7 days, replacing the previous one", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const first = await invite(deps, "ana", nova.id);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.invite.expiresAt).toBe("2026-11-22T12:00:00.000Z");

    const second = await invite(deps, "ana", nova.id);
    expect((await join(deps, first.token)).status).toBe(404); // replaced
    expect((await join(deps, second.token)).status).toBe(201);
    expect((await join(deps, second.token)).status).toBe(404); // used up

    const links = await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json();
    expect(links.invites).toEqual([]);
    expect(links.devices).toMatchObject([{ profileId: nova.id, label: "iPad · Safari" }]);
  });

  it("expires links and lets the parent cancel them", async () => {
    const { deps, later } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const old = await invite(deps, "ana", nova.id);
    later(7 * DAY);
    expect((await join(deps, old.token)).status).toBe(404);

    const fresh = await invite(deps, "ana", nova.id);
    await deleteLink(req(`/api/invites?profileId=${nova.id}`, { method: "DELETE", user: "ana" }), deps);
    expect((await join(deps, fresh.token)).status).toBe(404);
  });

  it("caps devices per kid", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    for (let i = 0; i < MAX_DEVICES_PER_PROFILE; i++) await linkDevice(deps, "ana", nova.id);
    const res = await createInvite(req("/api/invites", { method: "POST", user: "ana", body: { profileId: nova.id } }), deps);
    expect(res.status).toBe(400);
  });
});

describe("a kid's linked device", () => {
  it("previews the invitation, then joins as that kid with no account", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const { token } = await invite(deps, "ana", nova.id);

    const peek = await (await postKid(req("/api/kid", { method: "POST", body: { action: "peek", token } }), deps)).json();
    expect(peek.profile).toEqual({ id: nova.id, nickname: "Nova7", emoji: "🦊", color: "#4255ff" });
    expect(Object.keys(peek.profile)).not.toContain("showOnLeaderboard");

    const res = await join(deps, token);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(new RegExp(`^${KID_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$`));
    expect((await whoAmI(deps, cookieFrom(res))).profile).toMatchObject({ nickname: "Nova7" });
    expect(await whoAmI(deps)).toBeNull();
  });

  it("rejects made-up tokens and cookies", async () => {
    const { deps } = setup();
    expect((await join(deps, "x".repeat(43))).status).toBe(404);
    expect((await postKid(req("/api/kid", { method: "POST", body: { action: "join", token: "../../etc" } }), deps)).status).toBe(404);
    expect(await whoAmI(deps, `${KID_COOKIE}=${"y".repeat(43)}`)).toBeNull();
  });

  it("sees only the parent's decks meant for this kid", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const star = await kid(deps, "ana", "StarCat");
    const yaml = "title: Planets\nenabled: true\ncards:\n  - question: Largest?\n    options: [Jupiter, Mars]\n    answer: Jupiter\n";
    const deck = async (title: string) =>
      (await (await createDeck(req("/api/decks", { method: "POST", user: "ana", body: { yaml: yaml.replace("Planets", title) } }), deps)).json()).deck;
    const forAll = await deck("For all");
    const forStar = await deck("For StarCat");
    const off = await deck("Switched off");
    await updateDeck(req(`/api/decks?id=${forStar.id}`, { method: "PATCH", user: "ana", body: { profileIds: [star.id] } }), deps);
    await updateDeck(req(`/api/decks?id=${off.id}`, { method: "PATCH", user: "ana", body: { enabled: false } }), deps);

    const device = await linkDevice(deps, "ana", nova.id);
    expect((await whoAmI(deps, device)).decks.map((d: { id: string }) => d.id)).toEqual([forAll.id]);
  });

  it("studies as the kid and follows the parent's leaderboard choice", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const device = await linkDevice(deps, "ana", nova.id);

    const start = await startSession(req("/api/session", { method: "POST", body: { kid: true }, cookie: device }), deps);
    expect(start.status).toBe(201);
    expect(await start.json()).toMatchObject({ name: "Nova7", profileId: nova.id });
    const session = cookieFrom(start);
    const scored = await (await submitScore(req("/api/score", { method: "POST", cookie: session, body: { answers: [true] } }), deps)).json();
    expect(scored).toMatchObject({ pointsEarned: 10, leaderboard: { top: [] } }); // private by default

    // The points belong to the kid's profile even while it's off the leaderboard.
    expect((await whoAmI(deps, device)).totalPoints).toBe(10);
    const me = await (await getMe(req("/api/me", { user: "ana" }), deps)).json();
    expect(me.points).toEqual({ [nova.id]: 10 });

    await updateProfile(req(`/api/profiles?id=${nova.id}`, { method: "PATCH", user: "ana", body: { showOnLeaderboard: true } }), deps);
    expect((await (await getLeaderboard(req("/api/leaderboard"), deps)).json()).top).toEqual([{ rank: 1, name: "Nova7", points: 10 }]);

    expect((await startSession(req("/api/session", { method: "POST", body: { kid: true } }), deps)).status).toBe(401);
  });

  it("stops working when the parent removes it, or the kid unlinks it", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const tablet = await linkDevice(deps, "ana", nova.id);
    const laptop = await linkDevice(deps, "ana", nova.id);

    const { devices } = await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json();
    await deleteLink(req(`/api/invites?deviceId=${devices[0].id}`, { method: "DELETE", user: "ana" }), deps);
    expect(await whoAmI(deps, tablet)).toBeNull();
    expect((await startSession(req("/api/session", { method: "POST", body: { kid: true }, cookie: tablet }), deps)).status).toBe(401);

    const unlink = await deleteKid(req("/api/kid", { method: "DELETE", cookie: laptop }), deps);
    expect(unlink.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await whoAmI(deps, laptop)).toBeNull();
  });

  it("is unlinked when the profile or the whole account is deleted", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const star = await kid(deps, "ana", "StarCat");
    const novaDevice = await linkDevice(deps, "ana", nova.id);
    const starDevice = await linkDevice(deps, "ana", star.id);
    const pending = await invite(deps, "ana", star.id);

    await deleteProfile(req(`/api/profiles?id=${nova.id}`, { method: "DELETE", user: "ana" }), deps);
    expect(await whoAmI(deps, novaDevice)).toBeNull();
    expect(await whoAmI(deps, starDevice)).not.toBeNull();

    await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), deps);
    expect(await whoAmI(deps, starDevice)).toBeNull();
    expect((await join(deps, pending.token)).status).toBe(404);
  });

  it("joining again on the same device replaces its earlier link", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "ana", "Nova7");
    const star = await kid(deps, "ana", "StarCat");
    const first = await linkDevice(deps, "ana", nova.id);
    const { token } = await invite(deps, "ana", star.id);
    const second = cookieFrom(await join(deps, token, first));

    expect(await whoAmI(deps, first)).toBeNull();
    expect((await whoAmI(deps, second)).profile.nickname).toBe("StarCat");
    expect((await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json()).devices).toHaveLength(1);
  });
});

describe("isolation between accounts", () => {
  it("never lets parent B invite, see or unlink parent A's kids", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "parent-a", "Nova7");
    const device = await linkDevice(deps, "parent-a", nova.id);
    await invite(deps, "parent-a", nova.id);

    const asB = await createInvite(req("/api/invites", { method: "POST", user: "parent-b", body: { profileId: nova.id } }), deps);
    expect(asB.status).toBe(404);
    expect(await (await listLinks(req("/api/invites", { user: "parent-b" }), deps)).json()).toEqual({ invites: [], devices: [] });

    const { devices } = await (await listLinks(req("/api/invites", { user: "parent-a" }), deps)).json();
    const unlink = await deleteLink(req(`/api/invites?deviceId=${devices[0].id}`, { method: "DELETE", user: "parent-b" }), deps);
    expect(unlink.status).toBe(404);
    const cancel = await deleteLink(req(`/api/invites?profileId=${nova.id}`, { method: "DELETE", user: "parent-b" }), deps);
    expect(cancel.status).toBe(404);

    expect((await whoAmI(deps, device)).profile.nickname).toBe("Nova7");
    expect((await (await listLinks(req("/api/invites", { user: "parent-a" }), deps)).json()).invites).toHaveLength(1);
  });

  it("a kid device can't start a session as another profile", async () => {
    const { deps } = setup();
    const nova = await kid(deps, "parent-a", "Nova7");
    const rex = await kid(deps, "parent-b", "Rex");
    const device = await linkDevice(deps, "parent-a", nova.id);
    // The kid cookie isn't a parent sign-in, so naming another profile is refused.
    const res = await startSession(req("/api/session", { method: "POST", body: { profileId: rex.id }, cookie: device }), deps);
    expect(res.status).toBe(401);
  });
});

describe("device labels", () => {
  it("names devices without identifying details", () => {
    expect(deviceLabel(IPAD)).toBe("iPad · Safari");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36")).toBe("Android phone · Chrome");
    expect(deviceLabel(null)).toBe("Device");
  });
});
