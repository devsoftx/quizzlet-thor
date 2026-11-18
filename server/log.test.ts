// Every security event, triggered once through the real handlers with a
// captured logger. Also the rule: ids and outcomes only, never a token, a
// cookie, a session id or a nickname.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createProfile, deleteMe, deleteProfile, getMe } from "./account-handlers.js";
import { MAX_DEVICES_PER_PROFILE, MAX_FILES, MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import type { Deps } from "./deps.js";
import { accountFolder, MemoryFileStore } from "./files.js";
import { getLeaderboard, startSession, submitScore } from "./handlers.js";
import { createInvite, deleteKid, deleteLink, fingerprint, listLinks, postKid } from "./kid-handlers.js";
import { postFiles, putFile } from "./library-handlers.js";
import { consoleLogger, type LogEntry, type SecurityEvent } from "./log.js";
import { RATE_LIMITS } from "./route.js";
import { MemoryStore, PACE_BURST } from "./store.js";

const BASE = "https://localhost";
const NICKNAME = "Zephyrine";
const GUEST = "Quillon";

class TestAuth extends DevAuthenticator {
  override async deleteUser() {}
}

/** `idPrefix` keeps one scenario's made-up ids apart from another's. */
function setup(idPrefix = "id") {
  let ids = 0;
  const entries: LogEntry[] = [];
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new TestAuth(),
    files: new MemoryFileStore(),
    now: () => Date.UTC(2026, 10, 18, 12),
    newId: () => `${idPrefix}-${++ids}`,
    log: (entry) => entries.push(entry),
  };
  /** The entries logged by `action`, and nothing from before it. */
  async function during<T>(action: () => Promise<T>): Promise<{ result: T; logged: LogEntry[] }> {
    const before = entries.length;
    const result = await action();
    return { result, logged: entries.slice(before) };
  }
  return { deps, entries, during };
}

function req(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; user?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers({ "content-type": "application/json", ...init.headers });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

async function family(deps: Deps) {
  const made = await createProfile(req("/api/profiles", { method: "POST", user: "ana", body: { nickname: NICKNAME } }), deps);
  const kid = (await made.json()).profile as { id: string };
  return kid;
}

async function invite(deps: Deps, profileId: string) {
  const res = await createInvite(req("/api/invites", { method: "POST", user: "ana", body: { profileId } }), deps);
  return (await res.json()).token as string;
}

const join = (deps: Deps, token: string, cookie?: string) => postKid(req("/api/kid", { method: "POST", cookie, body: { action: "join", token } }), deps);

describe("security events", () => {
  /** Every secret and nickname the scenarios below create, to check none reaches the log. */
  const secrets: string[] = [NICKNAME, GUEST];
  const seen = new Map<SecurityEvent, LogEntry[]>();
  const record = (logged: LogEntry[]) => {
    for (const entry of logged) seen.set(entry.event, [...(seen.get(entry.event) ?? []), entry]);
  };

  it("auth.failed: a parent route without a valid sign-in", async () => {
    const { deps, during } = setup();
    const missing = await during(() => getMe(req("/api/me"), deps));
    expect(missing.result.status).toBe(401);
    expect(missing.logged).toEqual([{ event: "auth.failed", reason: "missing", path: "/api/me" }]);

    // A made-up parent header from somewhere that isn't this machine.
    const rejected = await during(() => getMe(new Request("https://quizzlet.example/api/me", { headers: { [DevAuthenticator.HEADER]: "ana" } }), deps));
    expect(rejected.logged).toEqual([{ event: "auth.failed", reason: "rejected", path: "/api/me" }]);

    const broken: Deps = { ...deps, auth: Object.assign(new TestAuth(), { authenticate: async () => { throw new Error("token expired for sk_live_abc"); } }) };
    const failed = await during(() => getMe(req("/api/me", { headers: { authorization: "Bearer not-a-real-token" } }), broken));
    expect(failed.result.status).toBe(401);
    expect(failed.logged).toEqual([{ event: "auth.failed", reason: "error", path: "/api/me" }]);
    secrets.push("not-a-real-token", "sk_live_abc");
    record([...missing.logged, ...rejected.logged, ...failed.logged]);
  });

  it("profile.deleted and account.deleted", async () => {
    const { deps, during } = setup();
    const kid = await family(deps);
    await family(deps);
    const profile = await during(() => deleteProfile(req(`/api/profiles?id=${kid.id}`, { method: "DELETE", user: "ana" }), deps));
    expect(profile.logged).toEqual([{ event: "profile.deleted", account: "dev_ana", profile: kid.id }]);
    // Someone else's profile: nothing happened, nothing to log.
    expect((await during(() => deleteProfile(req(`/api/profiles?id=${kid.id}`, { method: "DELETE", user: "ben" }), deps))).logged).toEqual([]);

    const account = await during(() => deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), deps));
    expect(account.logged).toEqual([{ event: "account.deleted", account: "dev_ana", profiles: 1 }]);
    record([...profile.logged, ...account.logged]);
  });

  it("invite.created, invite.redeemed, invite.refused and device.unlinked", async () => {
    const { deps, during } = setup();
    const kid = await family(deps);

    const created = await during(() => invite(deps, kid.id));
    expect(created.logged).toEqual([{ event: "invite.created", account: "dev_ana", profile: kid.id }]);
    const token = created.result;
    secrets.push(token);

    const joined = await during(() => join(deps, token));
    expect(joined.result.status).toBe(201);
    const device = cookieFrom(joined.result);
    secrets.push(device.split("=")[1]);
    const { devices } = await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json();
    expect(joined.logged).toEqual([{ event: "invite.redeemed", account: "dev_ana", profile: kid.id, device: devices[0].id }]);

    // Used up, never existed, not even shaped like a token.
    const used = await during(() => join(deps, token));
    expect(used.logged).toEqual([{ event: "invite.refused", reason: "not_open" }]);
    const unknown = await during(() => join(deps, "B".repeat(43)));
    expect(unknown.logged).toEqual([{ event: "invite.refused", reason: "not_open" }]);
    const malformed = await during(() => join(deps, "../../etc/passwd"));
    expect(malformed.logged).toEqual([{ event: "invite.refused", reason: "malformed" }]);

    // The device unlinks itself; a second try has nothing left to unlink.
    const byDevice = await during(() => deleteKid(req("/api/kid", { method: "DELETE", cookie: device }), deps));
    expect(byDevice.logged).toEqual([{ event: "device.unlinked", by: "device", account: "dev_ana", device: devices[0].id }]);
    expect((await during(() => deleteKid(req("/api/kid", { method: "DELETE", cookie: device }), deps))).logged).toEqual([]);

    // The parent removes one; joining again on a linked device replaces its link.
    const second = cookieFrom(await join(deps, await invite(deps, kid.id)));
    const again = await during(async () => join(deps, await invite(deps, kid.id), second));
    expect(again.logged.map((e) => `${e.event}${e.by ? `:${e.by}` : ""}`)).toEqual(["invite.created", "device.unlinked:rejoin", "invite.redeemed"]);
    const linked = (await (await listLinks(req("/api/invites", { user: "ana" }), deps)).json()).devices as Array<{ id: string }>;
    const byParent = await during(() => deleteLink(req(`/api/invites?deviceId=${linked[0].id}`, { method: "DELETE", user: "ana" }), deps));
    expect(byParent.logged).toEqual([{ event: "device.unlinked", by: "parent", account: "dev_ana", device: linked[0].id }]);

    // A link that is still open for a kid who, by now, has the most devices allowed.
    const accounts = deps.accounts!;
    const scope = accounts.forAccount("dev_ana");
    const [NOW, NEXT_WEEK, IN_180_DAYS] = ["2026-11-18T12:00:00.000Z", "2026-11-25T12:00:00.000Z", "2027-05-17T12:00:00.000Z"];
    for (let i = 0; i < MAX_DEVICES_PER_PROFILE; i++) {
      await scope.createInvite(kid.id, `hash-${i}`, NOW, NEXT_WEEK);
      await accounts.redeemInvite(`hash-${i}`, NOW, { id: `full-${i}`, tokenHash: `device-${i}`, label: "x", expiresAt: IN_180_DAYS });
    }
    const spare = "S".repeat(43);
    secrets.push(spare);
    await scope.createInvite(kid.id, fingerprint(spare), NOW, NEXT_WEEK);
    const full = await during(() => join(deps, spare));
    expect(full.result.status).toBe(400);
    expect(full.logged).toEqual([{ event: "invite.refused", reason: "device_limit", account: "dev_ana", profile: kid.id }]);

    record([...created.logged, ...joined.logged, ...used.logged, ...malformed.logged, ...byDevice.logged, ...again.logged, ...byParent.logged, ...full.logged]);
  });

  it("score.rejected: a save answered 409 or 429", async () => {
    const { deps, during } = setup("session-secret");
    const start = await startSession(req("/api/session", { method: "POST", body: { name: GUEST } }), deps);
    const cookie = cookieFrom(start);
    const { sessionTag } = (await start.json()) as { sessionTag: string };
    expect(cookie).toBe("qz_session=session-secret-1");
    secrets.push("session-secret-1");
    const save = (body: Record<string, unknown>) => submitScore(req("/api/score", { method: "POST", cookie, body }), deps);
    const session = sessionTag.slice(0, 12);

    const wrongSession = await during(() => save({ batchId: "a", answers: [true], sessionTag: "f".repeat(64) }));
    expect(wrongSession.result.status).toBe(409);
    expect(wrongSession.logged).toEqual([{ event: "score.rejected", status: 409, reason: "session_mismatch", session, profile: null }]);

    await save({ batchId: "b", answers: [true] });
    const conflict = await during(() => save({ batchId: "b", answers: [false] }));
    expect(conflict.result.status).toBe(409);
    expect(conflict.logged).toEqual([{ event: "score.rejected", status: 409, reason: "batch_conflict", session, profile: null }]);

    const tooFast = await during(() => save({ batchId: "c", answers: new Array(PACE_BURST).fill(true) }));
    expect(tooFast.result.status).toBe(429);
    expect(tooFast.logged).toEqual([{ event: "score.rejected", status: 429, reason: "pace", session, profile: null }]);

    // Accepted saves, bad input and an ended session aren't security events.
    expect((await during(() => save({ batchId: "d", answers: [true] }))).logged).toEqual([]);
    expect((await during(() => save({ batchId: "e", answers: ["yes"] }))).logged).toEqual([]);
    expect((await during(() => submitScore(req("/api/score", { method: "POST", body: { batchId: "f", answers: [true] } }), deps))).logged).toEqual([]);
    record([...wrongSession.logged, ...conflict.logged, ...tooFast.logged]);
  });

  it("upload.refused: over quota, a path that wasn't reserved, an upload that breaks the rules", async () => {
    const { deps, during } = setup();
    const start = (name: string, size: number) => postFiles(req("/api/files?action=start", { method: "POST", user: "ana", body: { name, size } }), deps);
    const stray = `${accountFolder("dev_ana")}uploads/abc-123/notes.pdf`;

    const put = await during(() => putFile(req(`/api/files?pathname=${encodeURIComponent(stray)}`, { method: "PUT", user: "ana", raw: new Uint8Array(10) }), deps));
    expect(put.result.status).toBe(403);
    expect(put.logged).toEqual([{ event: "upload.refused", account: "dev_ana", stage: "put", reason: "not_allowed" }]);

    const { pathname } = await (await start("notes.pdf", 10)).json();
    await (deps.files as MemoryFileStore).putLocal(pathname, { bytes: new Uint8Array(500), contentType: "application/pdf" });
    const confirm = await during(() => postFiles(req("/api/files?action=confirm", { method: "POST", user: "ana", body: { pathname, name: "notes.pdf" } }), deps));
    expect(confirm.result.status).toBe(400);
    expect(confirm.logged).toEqual([{ event: "upload.refused", account: "dev_ana", stage: "confirm", reason: "larger_than_declared" }]);

    for (let i = 0; i < MAX_FILES; i++) await start(`f${i}.pdf`, 1);
    const quota = await during(() => start("one-more.pdf", 1));
    expect(quota.result.status).toBe(400);
    expect(quota.logged).toEqual([{ event: "upload.refused", account: "dev_ana", stage: "start", reason: "quota" }]);

    const blob: Deps = { ...deps, files: Object.assign(new MemoryFileStore(), { mode: "blob" as const }) };
    const sign = await during(() => postFiles(req("/api/files?action=sign", { method: "POST", user: "ana", body: { type: "blob.generate-presigned-url", payload: { pathname: stray } } }), blob));
    expect(sign.result.status).toBe(403);
    expect(sign.logged).toEqual([{ event: "upload.refused", account: "dev_ana", stage: "sign", reason: "not_allowed" }]);
    record([...put.logged, ...confirm.logged, ...quota.logged, ...sign.logged]);
  });

  it("request.refused: another site's request, or a body that isn't JSON", async () => {
    const { deps, during } = setup();
    const crossSite = await during(() => startSession(req("/api/session", { method: "POST", body: { name: GUEST }, headers: { origin: "https://evil.example" } }), deps));
    expect(crossSite.result.status).toBe(403);
    expect(crossSite.logged).toEqual([{ event: "request.refused", route: "session.start", reason: "cross_origin" }]);

    const form = await during(() => postKid(req("/api/kid", { method: "POST", body: { action: "join", token: "A".repeat(43) }, headers: { "content-type": "text/plain" } }), deps));
    expect(form.result.status).toBe(415);
    expect(form.logged).toEqual([{ event: "request.refused", route: "kid.join", reason: "content_type" }]);
    record([...crossSite.logged, ...form.logged]);
  });

  it("rate_limit.exceeded: without the address that hit the limit", async () => {
    const { deps, during } = setup();
    const board = () => getLeaderboard(req("/api/leaderboard", { headers: { "x-real-ip": "203.0.113.50" } }), deps);
    for (let i = 0; i < RATE_LIMITS.leaderboard.max; i++) await board();
    const over = await during(board);
    expect(over.result.status).toBe(429);
    expect(over.logged).toEqual([{ event: "rate_limit.exceeded", route: "leaderboard.get", limit: "leaderboard" }]);
    secrets.push("203.0.113.50");
    record(over.logged);
  });

  it("error.unhandled: the error's kind, not its message, and the error still surfaces", async () => {
    const { deps, during, entries } = setup();
    deps.store!.leaderboard = async () => { throw new TypeError(`could not rank ${GUEST}`); };
    await expect(during(() => getLeaderboard(req("/api/leaderboard"), deps))).rejects.toThrow("could not rank");
    expect(entries).toEqual([{ event: "error.unhandled", route: "leaderboard.get", method: "GET", error: "TypeError" }]);
    record(entries);
  });

  it("covers every event type, and never logs a secret or a nickname", () => {
    const all: SecurityEvent[] = [
      "auth.failed",
      "account.deleted",
      "profile.deleted",
      "invite.created",
      "invite.redeemed",
      "invite.refused",
      "device.unlinked",
      "score.rejected",
      "upload.refused",
      "request.refused",
      "rate_limit.exceeded",
      "error.unhandled",
    ];
    expect([...seen.keys()].sort()).toEqual([...all].sort());

    const text = JSON.stringify([...seen.values()]);
    expect(secrets.length).toBeGreaterThan(6);
    for (const secret of secrets) expect(text, `the log holds "${secret}"`).not.toContain(secret);
    // Only short values: ids, counts and reason codes. Nothing that could carry a body or a header.
    for (const entry of [...seen.values()].flat()) {
      for (const [key, value] of Object.entries(entry)) {
        expect(["string", "number", "boolean"].includes(typeof value) || value === null, `${entry.event}.${key}`).toBe(true);
        expect(String(value).length, `${entry.event}.${key}`).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("the console logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line per event, at a level that fits it", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleLogger({ event: "invite.created", account: "user_1", profile: "p1" });
    consoleLogger({ event: "score.rejected", status: 429, reason: "pace" });
    consoleLogger({ event: "error.unhandled", route: "score.submit", method: "POST", error: "TypeError" });

    const line = out.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ ts: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/), level: "info", event: "invite.created", account: "user_1", profile: "p1" });
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ level: "warn", event: "score.rejected", status: 429 });
    expect(JSON.parse(err.mock.calls[0][0] as string)).toMatchObject({ level: "error", event: "error.unhandled" });
    expect([out, warn, err].map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
