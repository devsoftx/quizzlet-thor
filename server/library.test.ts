import { describe, expect, it } from "vitest";
import { createProfile, deleteMe, deleteProfile, getMe } from "./account-handlers.js";
import { MAX_DECKS, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_FILE_BYTES, MemoryAccounts } from "./accounts.js";
import { DevAuthenticator } from "./auth.js";
import type { Deps } from "./deps.js";
import {
  accountFolder,
  BlobFileStore,
  MemoryFileStore,
  parseUploadPath,
  storageName,
  UploadRefused,
  type FileStore,
} from "./files.js";
import {
  createDeck,
  deleteDeck,
  deleteFile,
  getFiles,
  listDecks,
  postFiles,
  putFile,
  updateDeck,
  UPLOAD_RESERVATION_MS,
} from "./library-handlers.js";
import { MemoryStore } from "./store.js";

const BASE = "https://quizzlet.test";

class TestAuth extends DevAuthenticator {
  override async deleteUser() {}
}

function setup(files: FileStore | null = new MemoryFileStore()) {
  let ids = 0;
  const deps: Deps = {
    store: new MemoryStore(),
    accounts: new MemoryAccounts(),
    auth: new TestAuth(),
    files,
    now: () => Date.UTC(2026, 10, 12, 12),
    newId: () => `id-${++ids}`,
  };
  return deps;
}

function req(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; user?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.user) headers.set(DevAuthenticator.HEADER, init.user);
  return new Request(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const DECK = `title: Planets
description: The solar system
enabled: true
cards:
  - question: Which planet is largest?
    options: [Jupiter, Mars, Venus]
    answer: Jupiter
  - question: Which planet is closest to the Sun?
    options: [Mercury, Earth, Neptune]
    answer: Mercury
`;

async function newDeck(deps: Deps, user: string, body: Record<string, unknown> = { yaml: DECK }) {
  const res = await createDeck(req("/api/decks", { method: "POST", user, body }), deps);
  expect(res.status).toBe(201);
  return (await res.json()).deck as { id: string; title: string; profileIds: string[] | null; enabled: boolean };
}

async function newProfile(deps: Deps, user: string, nickname: string) {
  const res = await createProfile(req("/api/profiles", { method: "POST", user, body: { nickname } }), deps);
  return (await res.json()).profile as { id: string };
}

/** start → send bytes → confirm, the way the browser does it in local mode. */
async function upload(deps: Deps, user: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const start = await postFiles(req("/api/files?action=start", { method: "POST", user, body: { name, size: bytes.byteLength } }), deps);
  if (start.status !== 200) return start;
  const { pathname } = await start.json();
  const put = await putFile(req(`/api/files?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", user, raw: bytes }), deps);
  expect(put.status).toBe(200);
  return postFiles(req("/api/files?action=confirm", { method: "POST", user, body: { pathname, name } }), deps);
}

const pdf = (size = 100) => new Uint8Array(size).fill(37);

describe("private library routes need a signed-in parent", () => {
  it("returns 401 without a sign-in", async () => {
    const calls = [
      () => listDecks(req("/api/decks"), setup()),
      () => createDeck(req("/api/decks", { method: "POST", body: { yaml: DECK } }), setup()),
      () => updateDeck(req("/api/decks?id=x", { method: "PATCH", body: {} }), setup()),
      () => deleteDeck(req("/api/decks?id=x", { method: "DELETE" }), setup()),
      () => getFiles(req("/api/files"), setup()),
      () => getFiles(req("/api/files?id=x&raw=1"), setup()),
      () => postFiles(req("/api/files?action=start", { method: "POST", body: { name: "a.pdf", size: 1 } }), setup()),
      () => putFile(req("/api/files?pathname=x", { method: "PUT", raw: pdf() }), setup()),
      () => deleteFile(req("/api/files?id=x", { method: "DELETE" }), setup()),
    ];
    for (const call of calls) expect((await call()).status).toBe(401);
  });

  it("returns 503 for files when no storage is connected", async () => {
    expect((await getFiles(req("/api/files", { user: "ana" }), setup(null))).status).toBe(503);
  });
});

describe("account decks", () => {
  it("saves valid decks and explains broken ones", async () => {
    const deps = setup();
    const deck = await newDeck(deps, "ana");
    expect(deck).toMatchObject({ title: "Planets", enabled: true, profileIds: null });
    expect((await (await listDecks(req("/api/decks", { user: "ana" }), deps)).json()).decks).toMatchObject([
      { title: "Planets", description: "The solar system", cardCount: 2, yaml: DECK },
    ]);

    const broken = await createDeck(req("/api/decks", { method: "POST", user: "ana", body: { yaml: "cards: [" } }), deps);
    expect(broken.status).toBe(400);
    expect((await broken.json()).errors[0]).toMatch(/YAML/);

    const huge = await createDeck(req("/api/decks", { method: "POST", user: "ana", body: { yaml: DECK + "#".repeat(70_000) } }), deps);
    expect(huge.status).toBe(400);
  });

  it("uses the file name when the deck has no title, and saves it switched on", async () => {
    const deps = setup();
    const noTitle = DECK.replace("title: Planets\n", "").replace("enabled: true", "enabled: false");
    const deck = await newDeck(deps, "ana", { yaml: noTitle, fileName: "space-facts.yaml" });
    expect(deck).toMatchObject({ title: "Space facts", enabled: true });
  });

  it("renames, switches off and assigns decks to the account's kids", async () => {
    const deps = setup();
    const kid = await newProfile(deps, "ana", "Nova7");
    const deck = await newDeck(deps, "ana");
    const res = await updateDeck(
      req(`/api/decks?id=${deck.id}`, { method: "PATCH", user: "ana", body: { title: "  My  planets ", enabled: false, profileIds: [kid.id] } }),
      deps,
    );
    expect((await res.json()).deck).toMatchObject({ title: "My planets", enabled: false, profileIds: [kid.id] });

    for (const body of [{ title: "" }, { enabled: "yes" }, { profileIds: ["nope"] }, { profileIds: "all" }]) {
      const bad = await updateDeck(req(`/api/decks?id=${deck.id}`, { method: "PATCH", user: "ana", body }), deps);
      expect(bad.status).toBe(400);
    }

    // Deleting the kid also drops them from the deck's list.
    await deleteProfile(req(`/api/profiles?id=${kid.id}`, { method: "DELETE", user: "ana" }), deps);
    const after = (await (await listDecks(req("/api/decks", { user: "ana" }), deps)).json()).decks[0];
    expect(after.profileIds).toEqual([]);
  });

  it("caps decks per account", async () => {
    const deps = setup();
    for (let i = 0; i < MAX_DECKS; i++) await newDeck(deps, "ana");
    expect((await createDeck(req("/api/decks", { method: "POST", user: "ana", body: { yaml: DECK } }), deps)).status).toBe(400);
  });
});

describe("account files (local mode)", () => {
  it("uploads, lists, reads and deletes a file", async () => {
    const deps = setup();
    const res = await upload(deps, "ana", "Science notes.pdf", pdf(1234));
    expect(res.status).toBe(201);
    const { file } = await res.json();
    expect(file).toEqual({ id: "id-1", name: "Science notes.pdf", contentType: "application/pdf", size: 1234, createdAt: expect.any(String) });
    expect(file).not.toHaveProperty("pathname");

    const list = await (await getFiles(req("/api/files", { user: "ana" }), deps)).json();
    expect(list).toMatchObject({ files: [{ id: file.id }], usage: { count: 1, bytes: 1234 }, uploadMode: "local" });

    const raw = await getFiles(req(`/api/files?id=${file.id}&raw=1`, { user: "ana" }), deps);
    expect(raw.headers.get("content-type")).toBe("application/pdf");
    expect(raw.headers.get("content-disposition")).toContain("Science%20notes.pdf");
    expect((await raw.arrayBuffer()).byteLength).toBe(1234);

    expect((await deleteFile(req(`/api/files?id=${file.id}`, { method: "DELETE", user: "ana" }), deps)).status).toBe(200);
    expect((deps.files as MemoryFileStore).paths()).toEqual([]);
  });

  it("only accepts study file types and sizes", async () => {
    const deps = setup();
    for (const name of ["virus.exe", "page.html", "notes.txt", "no-extension"]) {
      expect((await upload(deps, "ana", name, pdf())).status).toBe(400);
    }
    expect((await upload(deps, "ana", "big.pdf", pdf(MAX_FILE_BYTES + 1))).status).toBe(400);

    // The name sent at the end must match the type reserved at the start.
    const start = await (await postFiles(req("/api/files?action=start", { method: "POST", user: "ana", body: { name: "a.pdf", size: 10 } }), deps)).json();
    await putFile(req(`/api/files?pathname=${encodeURIComponent(start.pathname)}`, { method: "PUT", user: "ana", raw: pdf(10) }), deps);
    const mismatch = await postFiles(req("/api/files?action=confirm", { method: "POST", user: "ana", body: { pathname: start.pathname, name: "a.png" } }), deps);
    expect(mismatch.status).toBe(400);

    // Confirming a path that was never uploaded fails.
    const missing = start.pathname.replace("/id-", "/id-9");
    expect((await postFiles(req("/api/files?action=confirm", { method: "POST", user: "ana", body: { pathname: missing, name: "a.pdf" } }), deps)).status).toBe(400);
  });

  it("caps the number of files and the total size", async () => {
    const deps = setup();
    for (let i = 0; i < MAX_FILES; i++) expect((await upload(deps, "ana", `f${i}.pdf`, pdf())).status).toBe(201);
    expect((await upload(deps, "ana", "one-more.pdf", pdf())).status).toBe(400);

    const roomy = setup();
    const chunk = MAX_FILE_BYTES; // 15 MB each; the total cap is 50 MB
    for (let i = 0; i < Math.floor(MAX_TOTAL_FILE_BYTES / chunk); i++) {
      expect((await upload(roomy, "ben", `big${i}.pdf`, pdf(chunk))).status).toBe(201);
    }
    expect((await upload(roomy, "ben", "over.pdf", pdf(chunk))).status).toBe(400);
  });
});

describe("isolation between accounts", () => {
  it("never lets parent B see or change parent A's decks", async () => {
    const deps = setup();
    const deck = await newDeck(deps, "parent-a");
    const kidB = await newProfile(deps, "parent-b", "Rex");

    expect((await (await listDecks(req("/api/decks", { user: "parent-b" }), deps)).json()).decks).toEqual([]);
    const patch = await updateDeck(req(`/api/decks?id=${deck.id}`, { method: "PATCH", user: "parent-b", body: { title: "Hacked" } }), deps);
    expect(patch.status).toBe(404);
    expect((await deleteDeck(req(`/api/decks?id=${deck.id}`, { method: "DELETE", user: "parent-b" }), deps)).status).toBe(404);

    // A can't assign a deck to B's kid either.
    const assign = await updateDeck(req(`/api/decks?id=${deck.id}`, { method: "PATCH", user: "parent-a", body: { profileIds: [kidB.id] } }), deps);
    expect(assign.status).toBe(400);

    expect((await (await listDecks(req("/api/decks", { user: "parent-a" }), deps)).json()).decks).toMatchObject([{ title: "Planets", profileIds: null }]);
  });

  it("never lets parent B read, overwrite or delete parent A's files", async () => {
    const deps = setup();
    const { file } = await (await upload(deps, "parent-a", "a.pdf", pdf())).json();
    const [pathA] = (deps.files as MemoryFileStore).paths();

    expect((await (await getFiles(req("/api/files", { user: "parent-b" }), deps)).json()).files).toEqual([]);
    expect((await getFiles(req(`/api/files?id=${file.id}&raw=1`, { user: "parent-b" }), deps)).status).toBe(404);
    expect((await deleteFile(req(`/api/files?id=${file.id}`, { method: "DELETE", user: "parent-b" }), deps)).status).toBe(404);

    // B can't write into or claim A's folder.
    const put = await putFile(req(`/api/files?pathname=${encodeURIComponent(pathA)}`, { method: "PUT", user: "parent-b", raw: pdf(5) }), deps);
    expect(put.status).toBe(403);
    const claim = await postFiles(req("/api/files?action=confirm", { method: "POST", user: "parent-b", body: { pathname: pathA, name: "a.pdf" } }), deps);
    expect(claim.status).toBe(400);

    const raw = await getFiles(req(`/api/files?id=${file.id}&raw=1`, { user: "parent-a" }), deps);
    expect((await raw.arrayBuffer()).byteLength).toBe(100);
  });

  it("only signs Blob uploads for the parent's own folder and file types", async () => {
    const seen: Array<{ pathname: string; allowed: unknown }> = [];
    const fakeBlob: FileStore = {
      ...new MemoryFileStore(),
      mode: "blob",
      async presignUpload(_request, body, rule) {
        const pathname = (body as { payload: { pathname: string } }).payload.pathname;
        const allowed = rule(pathname);
        seen.push({ pathname, allowed });
        if (!allowed) throw new UploadRefused("no");
        return { type: "blob.generate-presigned-url", presignedUrlPayload: {} };
      },
    } as FileStore;
    const deps = setup(fakeBlob);
    const sign = (user: string, pathname: string) =>
      postFiles(req("/api/files?action=sign", { method: "POST", user, body: { type: "blob.generate-presigned-url", payload: { pathname, multipart: false, clientPayload: null } } }), deps);
    const start = async (user: string, name: string, size: number) =>
      (await (await postFiles(req("/api/files?action=start", { method: "POST", user, body: { name, size } }), deps)).json()).pathname as string;

    // A started upload: signed for its own path, its type, and the size that was declared (not the 15 MB maximum).
    const own = await start("parent-a", "notes.pdf", 4321);
    expect((await sign("parent-a", own)).status).toBe(200);
    expect(seen.at(-1)!.allowed).toEqual({ contentType: "application/pdf", maxBytes: 4321 });

    // A well-formed path in the parent's own folder that was never started is refused.
    const neverStarted = `${accountFolder("dev_parent-a")}uploads/abc-123/notes.pdf`;
    expect((await sign("parent-a", neverStarted)).status).toBe(403);

    const theirs = await start("parent-b", "notes.pdf", 100);
    for (const pathname of [
      own, // someone else asking for A's path
      `${accountFolder("dev_parent-b")}uploads/abc-123/../../${accountFolder("dev_parent-a")}x.pdf`,
      theirs.replace(/notes\.pdf$/, "page.html"),
      theirs.replace("/uploads/", "/other/"),
    ]) {
      expect((await sign("parent-b", pathname)).status).toBe(403);
    }
    expect((await sign("parent-b", theirs)).status).toBe(200);

    // The reservation runs out after 15 minutes: no more upload URLs for it.
    const base = deps.now();
    deps.now = () => base + UPLOAD_RESERVATION_MS;
    expect((await sign("parent-a", own)).status).toBe(403);
  });
});

describe("started uploads count against the quota (reservations)", () => {
  const start = (deps: Deps, user: string, name: string, size: number) =>
    postFiles(req("/api/files?action=start", { method: "POST", user, body: { name, size } }), deps);
  const put = (deps: Deps, user: string, pathname: string, bytes: Uint8Array<ArrayBuffer>) =>
    putFile(req(`/api/files?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", user, raw: bytes }), deps);
  const confirm = (deps: Deps, user: string, pathname: string, name: string) =>
    postFiles(req("/api/files?action=confirm", { method: "POST", user, body: { pathname, name } }), deps);
  const later = (deps: Deps, ms: number) => {
    const at = deps.now() + ms;
    deps.now = () => at;
  };

  it("refuses more uploads than the file limit, even when none is ever confirmed", async () => {
    const deps = setup();
    for (let i = 0; i < MAX_FILES; i++) expect((await start(deps, "ana", `f${i}.pdf`, 100)).status).toBe(200);
    const over = await start(deps, "ana", "one-more.pdf", 100);
    expect(over.status).toBe(400);
    expect((await over.json()).error).toContain(`up to ${MAX_FILES} files`);
    expect((await start(deps, "ben", "mine.pdf", 100)).status).toBe(200); // another account is unaffected
  });

  it("refuses started uploads that would go over the storage total", async () => {
    const deps = setup();
    for (let i = 0; i < Math.floor(MAX_TOTAL_FILE_BYTES / MAX_FILE_BYTES); i++) {
      expect((await start(deps, "ana", `big${i}.pdf`, MAX_FILE_BYTES)).status).toBe(200);
    }
    const over = await start(deps, "ana", "over.pdf", MAX_FILE_BYTES);
    expect(over.status).toBe(400);
    expect((await over.json()).error).toContain("file storage");
    expect((await start(deps, "ana", "small.pdf", 1024)).status).toBe(200); // what's left still fits
  });

  it("counts confirmed files and started uploads together", async () => {
    const deps = setup();
    for (let i = 0; i < MAX_FILES - 1; i++) expect((await upload(deps, "ana", `f${i}.pdf`, pdf())).status).toBe(201);
    expect((await start(deps, "ana", "last.pdf", 100)).status).toBe(200);
    expect((await start(deps, "ana", "over.pdf", 100)).status).toBe(400);
  });

  it("stops counting an upload once its 15 minutes are up", async () => {
    const deps = setup();
    for (let i = 0; i < MAX_FILES; i++) await start(deps, "ana", `f${i}.pdf`, 100);
    later(deps, UPLOAD_RESERVATION_MS - 1);
    expect((await start(deps, "ana", "still-full.pdf", 100)).status).toBe(400);
    later(deps, 1);
    expect((await start(deps, "ana", "room-again.pdf", 100)).status).toBe(200);
  });

  it("only takes bytes for a started upload, and no more than it declared", async () => {
    const deps = setup();
    const neverStarted = `${accountFolder("dev_ana")}uploads/abc-123/notes.pdf`;
    expect((await put(deps, "ana", neverStarted, pdf(10))).status).toBe(403);

    const { pathname } = await (await start(deps, "ana", "a.pdf", 10)).json();
    expect((await put(deps, "ana", pathname, pdf(11))).status).toBe(400);
    expect((await put(deps, "ana", pathname, pdf(10))).status).toBe(200);
    expect((await confirm(deps, "ana", pathname, "a.pdf")).status).toBe(201);
    // Confirming again (a retry) returns the same record.
    expect((await confirm(deps, "ana", pathname, "a.pdf")).status).toBe(200);
  });

  it("won't save an upload confirmed after its time ran out, and removes what was sent", async () => {
    const deps = setup();
    const { pathname } = await (await start(deps, "ana", "slow.pdf", 10)).json();
    await put(deps, "ana", pathname, pdf(10));
    later(deps, UPLOAD_RESERVATION_MS);
    const late = await confirm(deps, "ana", pathname, "slow.pdf");
    expect(late.status).toBe(400);
    expect((await late.json()).error).toBe("That upload took too long. Please try again.");
    expect((deps.files as MemoryFileStore).paths()).toEqual([]);
    expect((await (await getFiles(req("/api/files", { user: "ana" }), deps)).json()).usage).toEqual({ count: 0, bytes: 0 });
  });

  it("clears out an abandoned upload the next time the parent starts one", async () => {
    const deps = setup();
    const abandoned = (await (await start(deps, "ana", "abandoned.pdf", 10)).json()).pathname as string;
    await put(deps, "ana", abandoned, pdf(10));
    const kept = await upload(deps, "ana", "kept.pdf", pdf());
    expect(kept.status).toBe(201);
    later(deps, UPLOAD_RESERVATION_MS);
    expect((await start(deps, "ana", "next.pdf", 10)).status).toBe(200);
    const paths = (deps.files as MemoryFileStore).paths();
    expect(paths).not.toContain(abandoned);
    expect(paths).toHaveLength(1); // the confirmed file is untouched
  });
});

describe("storage paths", () => {
  it("builds safe, account-scoped paths", () => {
    expect(storageName("Résumé (final) v2.PDF", "pdf")).toBe("Resume-final-v2.pdf");
    expect(storageName("../../etc/passwd.docx", "docx")).toBe("etc-passwd.docx");
    expect(storageName("测试.png", "png")).toBe("file.png");
    expect(accountFolder("user_2abcXYZ")).toBe("users/user_2abcXYZ/");
    expect(accountFolder("weird/../id")).toMatch(/^users\/[0-9a-f]{32}\/$/);
    expect(parseUploadPath("u1", "users/u1/uploads/f-1/a.pdf")).toEqual({ fileId: "f-1", extension: "pdf" });
    expect(parseUploadPath("u1", "users/u2/uploads/f-1/a.pdf")).toBeNull();
    expect(parseUploadPath("u1", "users/u1/uploads/f-1/../a.pdf")).toBeNull();
  });

  it("refuses Blob callbacks and paths the rule rejects, before any network call", async () => {
    const store = new BlobFileStore();
    const request = req("/api/files?action=sign", { method: "POST" });
    await expect(store.presignUpload(request, { type: "blob.upload-completed", payload: {} }, () => null)).rejects.toBeInstanceOf(UploadRefused);
    const ask = { type: "blob.generate-presigned-url", payload: { pathname: "users/x/uploads/1/a.pdf", multipart: false, clientPayload: null } };
    await expect(store.presignUpload(request, ask, () => null)).rejects.toBeInstanceOf(UploadRefused);
  });
});

describe("deleting an account", () => {
  it("also removes its decks, file records and stored files", async () => {
    const deps = setup();
    await newDeck(deps, "ana");
    await upload(deps, "ana", "a.pdf", pdf());
    await upload(deps, "ben", "b.pdf", pdf());

    const res = await deleteMe(req("/api/me", { method: "DELETE", user: "ana", body: { confirm: true } }), deps);
    expect(res.status).toBe(200);
    expect((deps.files as MemoryFileStore).paths()).toEqual([expect.stringContaining("users/dev_ben/")]);

    await getMe(req("/api/me", { user: "ana" }), deps); // a fresh, empty account
    expect((await (await listDecks(req("/api/decks", { user: "ana" }), deps)).json()).decks).toEqual([]);
    expect((await (await getFiles(req("/api/files", { user: "ana" }), deps)).json()).files).toEqual([]);
  });
});
