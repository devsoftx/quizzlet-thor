// The security log: every event in docs/security/blue-remediation-plan.md (R2)
// is written once where it happens, with ids only: no token, cookie or nickname.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProfile, deleteMe, deleteProfile, getMe, updateProfile } from "./account-handlers.js";
import { MemoryAccounts } from "./accounts.js";
import { DevAuthenticator, type Authenticator } from "./auth.js";
import type { Deps } from "./deps.js";
import { MemoryFileStore, UploadRefused, type FileStore } from "./files.js";
import { getSession, startSession } from "./handlers.js";
import { createInvite, deleteKid, deleteLink, KID_COOKIE, listLinks, postKid } from "./kid-handlers.js";
import { createDeck, deleteDeck, deleteFile, postFiles, putFile } from "./library-handlers.js";
import { securityEvent, sessionHash } from "./log.js";
import { withErrors } from "./route.js";
import { MemoryStore, PACE_BURST } from "./store.js";
import { captureLog, cookieNamed, playing, score } from "./test-support.js";

const BASE = "https://quizzlet.test";
const DECK = "title: Planets\nenabled: true\ncards:\n  - question: Largest?\n    options: [Jupiter, Mars]\n    answer: Jupiter\n";

function setup(files: FileStore = new MemoryFileStore()) {
  let ids = 0;
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new DevAuthenticator(),
    files,
    now: () => Date.UTC(2026, 10, 15, 12),
    newId: () => `id-${++ids}`,
  };
  return deps;
}

function req(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; user?: string; cookie?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

let log: ReturnType<typeof captureLog>;
beforeEach(() => {
  log = captureLog();
});
afterEach(() => log.restore());

/** The event's fields without the timestamp and envelope. */
const fields = (event: string) => log.named(event).map(({ ts: _ts, kind: _kind, event: _event, ...rest }) => rest);

describe("sign-in and account events", () => {
  it("logs a refused and a failed sign-in check differently, with the route", async () => {
    const deps = setup();
    expect((await getMe(req("/api/me?secret=in-the-query"), deps)).status).toBe(401);
    expect(fields("auth.denied")).toEqual([{ route: "/api/me" }]);

    class BrokenProvider extends Error {
      override name = "ClerkAPIResponseError";
    }
    const broken: Authenticator = {
      authenticate: async () => {
        throw new BrokenProvider("secret key sk_live_abc is invalid");
      },
      describeUser: async () => ({ displayName: "x" }),
      deleteUser: async () => undefined,
    };
    expect((await getMe(req("/api/me", { user: "ana" }), { ...deps, auth: broken })).status).toBe(401);
    expect(fields("auth.error")).toEqual([{ route: "/api/me", errorName: "ClerkAPIResponseError" }]);
    expect(log.named("auth.denied")).toHaveLength(1); // the provider failing isn't a denial
    expect(log.lines.join("\n")).not.toContain("sk_live_abc");
    expect(log.lines.join("\n")).not.toContain("in-the-query");
  });

  it("logs the account, its profiles and its deletion by id", async () => {
    const deps = setup();
    await getMe(req("/api/me", { user: "ana" }), deps);
    await getMe(req("/api/me", { user: "ana" }), deps);
    expect(fields("account.created")).toEqual([{ accountId: "dev_ana" }]); // once, not on every visit

    const made = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "Nova7" } }), deps);
    const { id } = (await made.json()).profile as { id: string };
    expect(fields("profile.created")).toEqual([{ accountId: "dev_ana", profileId: id, listed: false }]);

    await updateProfile(req(`/api/profiles?id=${id}`, { method: "PATCH", user: "ana", body: { nickname: "Nova8" } }), deps);
    expect(log.named("profile.visibility")).toHaveLength(0); // a rename isn't a visibility change
    await updateProfile(req(`/api/profiles?id=${id}`, { method: "PATCH", user: "ana", body: { showOnLeaderboard: true } }), deps);
    expect(fields("profile.visibility")).toEqual([{ accountId: "dev_ana", profileId: id, listed: true }]);

    const other = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "StarCat" } }), deps);
    const otherId = ((await other.json()).profile as { id: string }).id;
    await deleteProfile(req(`/api/profiles?id=${otherId}`, { method: "DELETE", user: "ana" }), deps);
    await deleteProfile(req(`/api/profiles?id=${otherId}`, { method: "DELETE", user: "ana" }), deps); // already gone: 404, no event
    expect(fields("profile.deleted")).toEqual([{ accountId: "dev_ana", profileId: otherId }]);

    await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), deps);
    expect(fields("account.deleted")).toEqual([{ accountId: "dev_ana", deletedProfiles: 1 }]);

    const written = log.lines.join("\n");
    for (const nickname of ["Nova7", "Nova8", "StarCat"]) expect(written).not.toContain(nickname);
  });
});

describe("kid link events", () => {
  it("logs invitations and devices without the invitation token or the device cookie", async () => {
    const deps = setup();
    const made = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "Nova7" } }), deps);
    const profileId = ((await made.json()).profile as { id: string }).id;
    const invite = async () => ((await (await createInvite(req("/api/invites", { method: "POST", user: "ana", body: { profileId } }), deps)).json()) as { token: string }).token;
    const join = (token: string, cookie?: string) => postKid(req("/api/kid", { method: "POST", body: { action: "join", token }, cookie }), deps);
    const secrets: string[] = [];

    // A link made, then cancelled.
    secrets.push(await invite());
    await deleteLink(req(`/api/invites?profileId=${profileId}`, { method: "DELETE", user: "ana" }), deps);
    await deleteLink(req(`/api/invites?profileId=${profileId}`, { method: "DELETE", user: "ana" }), deps); // nothing left to cancel
    expect(fields("invite.cancelled")).toEqual([{ accountId: "dev_ana", profileId }]);

    // Guessed, cancelled and malformed tokens are misses.
    await postKid(req("/api/kid", { method: "POST", body: { action: "peek", token: "A".repeat(43) } }), deps);
    await join(secrets[0]);
    await postKid(req("/api/kid", { method: "POST", body: { action: "drop table", token: "../../etc" } }), deps);
    expect(fields("invite.miss")).toEqual([{ action: "peek" }, { action: "join" }, { action: "other" }]);

    // A device links, links again as the same kid (replacing itself), and unlinks itself.
    const first = await join((secrets[1] = await invite()));
    const firstCookie = cookieNamed(first, KID_COOKIE)!;
    const second = await join((secrets[2] = await invite()), firstCookie);
    const secondCookie = cookieNamed(second, KID_COOKIE)!;
    await deleteKid(req("/api/kid", { method: "DELETE", cookie: secondCookie }), deps);
    // Another device, removed by the parent.
    const third = await join((secrets[3] = await invite()));
    const { devices } = (await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json()) as { devices: Array<{ id: string }> };
    await deleteLink(req(`/api/invites?deviceId=${devices[0].id}`, { method: "DELETE", user: "ana" }), deps);

    expect(log.named("invite.created")).toHaveLength(4);
    expect(fields("invite.created")[0]).toEqual({ accountId: "dev_ana", profileId });
    const linked = fields("device.linked");
    expect(linked).toHaveLength(3);
    expect(linked[0]).toEqual({ accountId: "dev_ana", profileId, deviceId: expect.any(String) });
    expect(fields("device.unlinked")).toEqual([
      { accountId: "dev_ana", profileId, deviceId: linked[0].deviceId, by: "replaced" },
      { accountId: "dev_ana", profileId, deviceId: linked[1].deviceId, by: "kid" },
      { accountId: "dev_ana", profileId, deviceId: linked[2].deviceId, by: "parent" },
    ]);

    const written = log.lines.join("\n");
    for (const token of secrets) expect(written).not.toContain(token);
    for (const res of [first, second, third]) expect(written).not.toContain(cookieNamed(res, KID_COOKIE)!.split("=")[1]);
    expect(written).not.toContain("Nova7");
  });
});

describe("session and score events", () => {
  it("logs each kind of session start by a hash of its id, never the cookie or the name", async () => {
    const deps = setup();
    const made = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: "Nova7" } }), deps);
    const profileId = ((await made.json()).profile as { id: string }).id;
    const token = ((await (await createInvite(req("/api/invites", { method: "POST", user: "ana", body: { profileId } }), deps)).json()) as { token: string }).token;
    const device = cookieNamed(await postKid(req("/api/kid", { method: "POST", body: { action: "join", token } }), deps), KID_COOKIE)!;

    const guest = await startSession(req("/api/session", { method: "POST", body: { name: "Guest Gus" } }), deps);
    const profile = await startSession(req("/api/session", { method: "POST", user: "ana", body: { profileId } }), deps);
    const kid = await startSession(req("/api/session", { method: "POST", body: { kid: true }, cookie: device }), deps);
    const ids = [guest, profile, kid].map((res) => cookieNamed(res, "qz_session")!.split("=")[1]);

    expect(fields("session.started")).toEqual([
      { sessionKind: "guest", sessionHash: sessionHash(ids[0]), profileId: null },
      { sessionKind: "profile", sessionHash: sessionHash(ids[1]), profileId },
      { sessionKind: "kid", sessionHash: sessionHash(ids[2]), profileId },
    ]);

    // Deleting the profile ends both of its sessions the next time they're used.
    await deleteProfile(req(`/api/profiles?id=${profileId}`, { method: "DELETE", user: "ana" }), deps);
    expect((await getSession(req("/api/session", { cookie: `qz_session=${ids[1]}` }), deps)).status).toBe(403);
    expect((await getSession(req("/api/session", { cookie: `qz_session=${ids[2]}; ${device}` }), deps)).status).toBe(403);
    expect(fields("session.revoked")).toEqual([
      { sessionKind: "profile", sessionHash: sessionHash(ids[1]), profileId },
      { sessionKind: "kid", sessionHash: sessionHash(ids[2]), profileId },
    ]);

    const written = log.lines.join("\n");
    for (const id of ids) expect(written).not.toContain(id);
    expect(written).not.toContain(cookieNamed(guest, "qz_guest")!.split("=")[1]);
    expect(written).not.toContain(device.split("=")[1]);
    for (const name of ["Guest Gus", "Nova7"]) expect(written).not.toContain(name);
  });

  it("logs saved, replayed, conflicting and rate-limited score batches", async () => {
    const deps = setup();
    const started = await startSession(req("/api/session", { method: "POST", body: { name: "Guest Gus" } }), deps);
    const who = await playing(started);
    const hash = sessionHash(cookieNamed(started, "qz_session")!.split("=")[1]);

    await score(deps, who, { batchId: "one", answers: [true, false, true] });
    expect(fields("score.saved")).toEqual([{ sessionHash: hash, profileId: null, answers: 3, points: 20, batch: "one" }]);

    await score(deps, who, { batchId: "one", answers: [true, false, true] });
    expect(fields("score.replay")).toEqual([{ sessionHash: hash, profileId: null, answers: 3, points: 20, batch: "one" }]);

    await score(deps, who, { batchId: "one", answers: [true] });
    await score(deps, { ...who, sessionTag: "another-session" }, { batchId: "two", answers: [true] });
    expect(fields("score.conflict")).toEqual([
      { sessionHash: hash, profileId: null, reason: "batch", batch: "one" },
      { sessionHash: hash, profileId: null, reason: "session" },
    ]);

    await score(deps, who, { batchId: "flood", answers: new Array(PACE_BURST).fill(true) });
    expect(fields("score.limited")).toEqual([{ sessionHash: hash, profileId: null, answers: PACE_BURST, batch: "flood" }]);

    // Asking for the totals (no answers) isn't a score event.
    await score(deps, who, { batchId: "totals", answers: [], leaderboard: true });
    expect(log.named("score.saved")).toHaveLength(1);
    expect(log.lines.join("\n")).not.toContain("Guest Gus");
  });
});

describe("deck and file events", () => {
  it("logs decks and local uploads by id and size", async () => {
    const deps = setup();
    const made = await createDeck(req("/api/decks", { method: "POST", user: "ana", body: { yaml: DECK, fileName: "secret-plans.yaml" } }), deps);
    const deckId = ((await made.json()).deck as { id: string }).id;
    await deleteDeck(req(`/api/decks?id=${deckId}`, { method: "DELETE", user: "ana" }), deps);
    await deleteDeck(req(`/api/decks?id=${deckId}`, { method: "DELETE", user: "ana" }), deps); // 404, no event
    expect(fields("deck.created")).toEqual([{ accountId: "dev_ana", deckId }]);
    expect(fields("deck.deleted")).toEqual([{ accountId: "dev_ana", deckId }]);

    const start = async (name: string, size: number) =>
      ((await (await postFiles(req("/api/files?action=start", { method: "POST", user: "ana", body: { name, size } }), deps)).json()) as { pathname: string }).pathname;
    const put = (pathname: string, size: number) =>
      putFile(req(`/api/files?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", user: "ana", raw: new Uint8Array(size).fill(37) }), deps);
    const confirm = (pathname: string, name: string) => postFiles(req("/api/files?action=confirm", { method: "POST", user: "ana", body: { pathname, name } }), deps);

    const pathname = await start("Family budget.pdf", 1234);
    await put(pathname, 1234);
    const saved = await confirm(pathname, "Family budget.pdf");
    const fileId = ((await saved.json()).file as { id: string }).id;
    expect(fields("file.confirmed")).toEqual([{ accountId: "dev_ana", fileId, bytes: 1234 }]);

    // An upload that isn't what was started is rejected and logged with the reason.
    const wrongType = await start("picture.png", 10);
    await (deps.files as MemoryFileStore).putLocal(wrongType, { bytes: new Uint8Array(10), contentType: "text/html" });
    expect((await confirm(wrongType, "picture.png")).status).toBe(400);
    expect(fields("file.rejected")).toEqual([{ accountId: "dev_ana", fileId: expect.any(String), bytes: 10, reason: "type" }]);

    await deleteFile(req(`/api/files?id=${fileId}`, { method: "DELETE", user: "ana" }), deps);
    expect(fields("file.deleted")).toEqual([{ accountId: "dev_ana", fileId }]);

    const written = log.lines.join("\n");
    for (const text of ["Family budget", "secret-plans", "Planets", pathname]) expect(written).not.toContain(text);
  });

  it("logs signed and refused upload URLs (Blob storage)", async () => {
    const fakeBlob = {
      mode: "blob",
      async presignUpload(_request: Request, body: unknown, rule: (pathname: string) => unknown) {
        const pathname = (body as { payload?: { pathname?: string } } | null)?.payload?.pathname;
        if (!pathname || !rule(pathname)) throw new UploadRefused("You can't upload to that location.");
        return { ok: true };
      },
      async delete() {},
    } as unknown as FileStore;
    const deps = setup(fakeBlob);
    const sign = (pathname?: string) =>
      postFiles(req("/api/files?action=sign", { method: "POST", user: "ana", body: pathname ? { type: "blob.generate-presigned-url", payload: { pathname } } : {} }), deps);
    const started = await postFiles(req("/api/files?action=start", { method: "POST", user: "ana", body: { name: "notes.pdf", size: 4321 } }), deps);
    const { pathname } = (await started.json()) as { pathname: string };

    expect((await sign(pathname)).status).toBe(200);
    expect(fields("file.sign")).toEqual([{ accountId: "dev_ana", fileId: expect.any(String), bytes: 4321 }]);

    expect((await sign(pathname.replace("/uploads/id-", "/uploads/other-"))).status).toBe(403); // never started
    expect((await sign("users/dev_someone-else/uploads/x/notes.pdf")).status).toBe(403);
    expect((await sign()).status).toBe(403);
    expect(fields("file.sign.refused")).toEqual([
      { accountId: "dev_ana", reason: "reservation" },
      { accountId: "dev_ana", reason: "path" },
      { accountId: "dev_ana", reason: "request" },
    ]);
  });

  it("logs an upload refused for the quota", async () => {
    const deps = setup();
    const start = (i: number) => postFiles(req("/api/files?action=start", { method: "POST", user: "ana", body: { name: `f${i}.pdf`, size: 10 } }), deps);
    for (let i = 0; i < 20; i++) expect((await start(i)).status).toBe(200);
    expect((await start(20)).status).toBe(400);
    expect(fields("file.rejected")).toEqual([{ accountId: "dev_ana", fileId: expect.any(String), bytes: 10, reason: "quota:files" }]);
  });
});

describe("unexpected errors", () => {
  it("are logged with the route and answered with a generic 500", async () => {
    const boom = withErrors("/api/example", async () => {
      throw new TypeError("connection string postgres://user:password@host/db refused");
    });
    const res = await boom(new Request(`${BASE}/api/example?id=123`, { headers: { "x-vercel-id": "iad1::abc-123" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong." });
    expect(fields("request.error")).toEqual([{ route: "/api/example", method: "GET", errorName: "TypeError", requestId: "iad1::abc-123" }]);
    expect(log.lines.join("\n")).not.toContain("password");
  });

  it("every line is one JSON object with a timestamp and the security marker", async () => {
    const deps = setup();
    await getMe(req("/api/me"), deps);
    expect(log.lines).toHaveLength(1);
    expect(JSON.parse(log.lines[0])).toEqual({ ts: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/), kind: "security", event: "auth.denied", route: "/api/me" });
  });

  it("a field can't replace the envelope", () => {
    securityEvent("example", { kind: "other", event: "spoofed", ts: "never" });
    expect(JSON.parse(log.lines[0])).toMatchObject({ kind: "security", event: "example", ts: expect.stringMatching(/^\d{4}-/) });
  });
});
