import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMe } from "./account-handlers.js";
import { MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import { GUESTS_KEPT, ORPHAN_AGE_MS, runCleanup } from "./cron-handlers.js";
import type { Deps } from "./deps.js";
import { MemoryFileStore } from "./files.js";
import { postFiles, putFile, UPLOAD_RESERVATION_MS } from "./library-handlers.js";
import { MemoryStore, type Session } from "./store.js";
import { captureLog } from "./test-support.js";

const BASE = "https://quizzlet.test";
const SECRET = "cron-secret-for-tests";
const HOUR = 60 * 60 * 1000;

function setup() {
  let ids = 0;
  let now = Date.UTC(2026, 10, 12, 12);
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new DevAuthenticator(),
    files: new MemoryFileStore(),
    now: () => now,
    newId: () => `id-${++ids}`,
    cronSecret: SECRET,
  };
  return { deps, later: (ms: number) => (now += ms) };
}

const cron = (deps: Deps, authorization: string | null = `Bearer ${SECRET}`) =>
  runCleanup(new Request(`${BASE}/api/cron`, { headers: authorization ? { authorization } : {} }), deps);

function req(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; user: string }) {
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", [DevAuthenticator.HEADER]: init.user },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const pdf = (size = 100) => new Uint8Array(size).fill(37);

/** Starts an upload and sends its bytes; `confirm` records it as a file. */
async function upload(deps: Deps, user: string, name: string, confirm: boolean) {
  const start = await postFiles(req("/api/files?action=start", { user, body: { name, size: 100 } }), deps);
  const { pathname } = (await start.json()) as { pathname: string };
  expect((await putFile(req(`/api/files?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", user, raw: pdf() }), deps)).status).toBe(200);
  if (confirm) expect((await postFiles(req("/api/files?action=confirm", { user, body: { pathname, name } }), deps)).status).toBe(201);
  return pathname;
}

let log: ReturnType<typeof captureLog>;
beforeEach(() => {
  log = captureLog();
});
afterEach(() => log.restore());

describe("the scheduled cleanup route", () => {
  it("refuses to run without a configured secret, and for anyone who doesn't present it", async () => {
    const { deps } = setup();
    expect((await runCleanup(new Request(`${BASE}/api/cron`), { ...deps, cronSecret: null })).status).toBe(503);
    for (const authorization of [null, "Bearer wrong", SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`]) {
      expect((await cron(deps, authorization)).status, String(authorization)).toBe(401);
    }
    expect(log.named("cron.denied")).toHaveLength(5);
    const ok = await cron(deps);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, guests: { removed: 0 }, uploads: { deleted: 0 } });
  });

  it("still runs the other task when one fails, and reports the failure", async () => {
    const { deps } = setup();
    deps.store!.pruneGuests = async () => {
      throw new Error("redis is down");
    };
    const res = await cron(deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, guests: { failed: true }, uploads: { deleted: 0 } });
    expect(log.named("cron.error")).toEqual([expect.objectContaining({ task: "guests", errorName: "Error" })]);
    expect(log.lines.join("\n")).not.toContain("redis is down"); // messages can hold user data
  });
});

describe("guest leaderboard pruning", () => {
  it("keeps the top 1,000 guests and every kid profile out of 2,000 guests", async () => {
    const { deps } = setup();
    const store = deps.store as MemoryStore;
    const now = deps.now();
    let sessions = 0;
    /** One session that saves `corrects` separate single-answer batches: 10 points each. */
    const earn = async (player: Pick<Session, "name" | "playerKey" | "profileId" | "listed" | "emoji">, corrects: number) => {
      const session: Session = { id: `s${++sessions}`, ...player, expiresAt: now + HOUR, points: 0 };
      await store.createSession(session);
      for (let i = 0; i < corrects; i++) {
        await store.addScoreBatch(session, { id: `b${i}`, fingerprint: "f", answers: [true], streakBefore: 0 }, now);
      }
    };
    // 2,000 guests: the first 1,000 have 30 points, the other 1,000 have 10.
    for (let i = 0; i < 2000; i++) await earn({ name: `Guest ${i}`, playerKey: `guest ${i}` }, i < 1000 ? 3 : 1);
    // Kid profiles: one high on the board, one at the very bottom, one private.
    await earn({ name: "Top Kid", playerKey: "p:top", profileId: "top", listed: true, emoji: "🚀" }, 5);
    await earn({ name: "Low Kid", playerKey: "p:low", profileId: "low", listed: true, emoji: "🐢" }, 1);
    await earn({ name: "Private Kid", playerKey: "p:private", profileId: "private", listed: false }, 1);
    expect((await store.leaderboard(5000)).top).toHaveLength(2002);

    const res = await cron(deps);
    expect(await res.json()).toMatchObject({ guests: { removed: 1000 } });

    const board = await store.leaderboard(5000);
    const guests = board.top.filter((e) => !e.emoji);
    expect(guests).toHaveLength(GUESTS_KEPT);
    expect(guests.every((e) => e.points === 30)).toBe(true); // exactly the 1,000 with more points
    expect(board.top.filter((e) => e.emoji).map((e) => e.name).sort()).toEqual(["Low Kid", "Top Kid"]);
    expect(await store.totalsFor(["p:top", "p:low", "p:private"])).toEqual({ "p:top": 50, "p:low": 10, "p:private": 10 });
    expect(log.named("leaderboard.pruned")).toEqual([expect.objectContaining({ removed: 1000, kept: GUESTS_KEPT })]);

    // Running it again changes nothing.
    expect(await (await cron(deps)).json()).toMatchObject({ guests: { removed: 0 } });
    expect((await store.leaderboard(5000)).top).toHaveLength(GUESTS_KEPT + 2);
  });
});

describe("unconfirmed upload cleanup", () => {
  it("deletes an old upload that was never confirmed, and nothing else", async () => {
    const { deps, later } = setup();
    await getMe(new Request(`${BASE}/api/me`, { headers: { [DevAuthenticator.HEADER]: "ana" } }), deps);
    const confirmed = await upload(deps, "ana", "kept.pdf", true);
    const abandoned = await upload(deps, "ana", "abandoned.pdf", false);
    const files = deps.files as MemoryFileStore;

    // After 15 minutes the reservation is over, but the bytes are less than a day old: left alone.
    later(UPLOAD_RESERVATION_MS + 1);
    expect(await (await cron(deps)).json()).toMatchObject({ uploads: { scanned: 2, deleted: 0 } });
    expect(files.paths()).toEqual([abandoned, confirmed].sort());

    later(ORPHAN_AGE_MS);
    const recent = await upload(deps, "ana", "in-progress.pdf", false); // started just now: its reservation is live
    const res = await cron(deps);
    expect(await res.json()).toMatchObject({ ok: true, uploads: { scanned: 3, deleted: 1 } });
    expect(files.paths()).toEqual([confirmed, recent].sort());
    expect(log.named("file.orphan.deleted").at(-1)).toMatchObject({ scanned: 3, deleted: 1 });
  });

  it("deletes nothing when the database recognises none of the stored files (wrong or empty database)", async () => {
    const { deps, later } = setup();
    for (let i = 0; i < 12; i++) await upload(deps, `parent-${i}`, "notes.pdf", true);
    later(ORPHAN_AGE_MS + 1);
    const stored = (deps.files as MemoryFileStore).paths();

    // The same file store, looked at through a database that has never heard of these files.
    const res = await cron({ ...deps, accounts: new MemoryAccounts() });
    expect(await res.json()).toMatchObject({ uploads: { scanned: 12, deleted: 0, aborted: true } });
    expect((deps.files as MemoryFileStore).paths()).toEqual(stored);
    expect(log.named("file.orphan.aborted")).toHaveLength(1);

    // With the right database, all twelve are known and stay.
    expect(await (await cron(deps)).json()).toMatchObject({ uploads: { scanned: 12, deleted: 0 } });
    expect((deps.files as MemoryFileStore).paths()).toEqual(stored);
  });

  it("is skipped when there is no file storage or no database", async () => {
    const { deps } = setup();
    expect(await (await cron({ ...deps, files: null })).json()).toMatchObject({ ok: true, uploads: { skipped: true } });
    expect(await (await cron({ ...deps, accounts: null, store: null })).json()).toMatchObject({ ok: true, guests: { skipped: true }, uploads: { skipped: true } });
  });
});
