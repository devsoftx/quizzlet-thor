// /api/decks and /api/files: a signed-in parent's private decks and files.
// Like the profile routes, everything goes through requireAccount, so data is
// only reached via accounts.forAccount(<the verified user id>).

import { parseDeck, titleFromFileName } from "../src/deck.js";
import {
  FILE_TYPES,
  fileTypeFor,
  LimitReached,
  MAX_DECK_BYTES,
  MAX_DECKS,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_FILE_BYTES,
  type AccountFile,
  type AccountScope,
  type DeckPatch,
  type StoredFile,
} from "./accounts.js";
import { ensureAccount, requireAccount, type AccountContext } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { parseUploadPath, UploadRefused, uploadPath, type FileStore } from "./files.js";
import { error, json, readJson } from "./http.js";
import { securityEvent } from "./log.js";

/** How long a started upload holds its place in the quota before it must be confirmed. */
export const UPLOAD_RESERVATION_MS = 15 * 60 * 1000;
/**
 * An upload whose reservation ran out this long ago can no longer be saved by
 * any request still in flight, so what was sent for it may be deleted.
 */
export const ABANDONED_AFTER_MS = 60 * 1000;
/** How many of an account's abandoned uploads one request clears away. */
const ABANDONED_PER_REQUEST = 200;

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 300;
const FILE_NAME_MAX = 120;

const params = (request: Request) => new URL(request.url).searchParams;
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
const iso = (ms: number) => new Date(ms).toISOString();

const TOO_MANY_DECKS = `You can keep up to ${MAX_DECKS} decks.`;
const TOO_MANY_FILES = `You can keep up to ${MAX_FILES} files. Delete one to make room.`;
const STORAGE_FULL = `That would go over your ${mb(MAX_TOTAL_FILE_BYTES)} of file storage. Delete a file to make room.`;

/** Trimmed single-line text without control characters, or null if empty/too long. */
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return text.length >= 1 && text.length <= max ? text : null;
}

/** null (all kids) or a list of this account's profile ids; a string is an error message. */
async function parseProfileIds(raw: unknown, scope: AccountScope): Promise<string[] | null | string> {
  if (raw === null) return null;
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) return "profileIds must be null or a list of profile ids.";
  const own = new Set((await scope.listProfiles()).map((p) => p.id));
  if (!raw.every((id) => own.has(id))) return "Profile not found.";
  return [...new Set(raw as string[])];
}

// --------------------------------------------------------------- /api/decks

export async function listDecks(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return json({ decks: await ctx.scope.listDecks() });
}

/** POST {fileName?, yaml, profileIds?}: save a valid deck to the account. */
export async function createDeck(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const body = (await readJson(request)) ?? {};

  const yaml = body.yaml;
  if (typeof yaml !== "string" || !yaml.trim()) return error(400, "Send the deck's YAML text.");
  if (new TextEncoder().encode(yaml).byteLength > MAX_DECK_BYTES) {
    return error(400, `That deck is too big (up to ${MAX_DECK_BYTES / 1024} KB).`);
  }
  if ((await ctx.scope.listDecks()).length >= MAX_DECKS) return error(400, TOO_MANY_DECKS);

  const fileName = typeof body.fileName === "string" ? body.fileName : "deck.yaml";
  const parsed = parseDeck(yaml, titleFromFileName(fileName));
  if (!parsed.ok) {
    return json({ error: "This deck has problems.", errors: parsed.errors.slice(0, 10) }, 400);
  }
  const profileIds = await parseProfileIds(body.profileIds ?? null, ctx.scope);
  if (typeof profileIds === "string") return error(400, profileIds);

  let deck;
  try {
    deck = await ctx.scope.createDeck(deps.newId(), {
      title: cleanText(parsed.deck.title, TITLE_MAX) ?? titleFromFileName(fileName).slice(0, TITLE_MAX),
      description: cleanText(parsed.deck.description, DESCRIPTION_MAX),
      cardCount: parsed.deck.cards.length,
      yaml,
      // A saved deck is on until the parent turns it off; the file's own
      // `enabled` flag is for the shared decks/ folder.
      enabled: true,
      profileIds,
    });
  } catch (err) {
    // The database enforces the limit too: parallel requests can pass the check above together.
    if (err instanceof LimitReached) return error(400, TOO_MANY_DECKS);
    throw err;
  }
  securityEvent("deck.created", { accountId: ctx.userId, deckId: deck.id });
  return json({ deck }, 201);
}

/** PATCH ?id= {title?, enabled?, profileIds?} */
export async function updateDeck(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const body = (await readJson(request)) ?? {};

  const patch: DeckPatch = {};
  if (body.title !== undefined) {
    const title = cleanText(body.title, TITLE_MAX);
    if (!title) return error(400, `Please enter a title (up to ${TITLE_MAX} characters).`);
    patch.title = title;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return error(400, "enabled must be true or false.");
    patch.enabled = body.enabled;
  }
  if (body.profileIds !== undefined) {
    const ids = await parseProfileIds(body.profileIds, ctx.scope);
    if (typeof ids === "string") return error(400, ids);
    patch.profileIds = ids;
  }
  const deck = await ctx.scope.updateDeck(params(request).get("id") ?? "", patch);
  return deck ? json({ deck }) : error(404, "Deck not found.");
}

export async function deleteDeck(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  const id = params(request).get("id") ?? "";
  if (!(await ctx.scope.deleteDeck(id))) return error(404, "Deck not found.");
  securityEvent("deck.deleted", { accountId: ctx.userId, deckId: id });
  return json({ ok: true });
}

// --------------------------------------------------------------- /api/files

interface FileContext extends AccountContext {
  files: FileStore;
}

async function requireFiles(request: Request, deps: Deps): Promise<FileContext | Response> {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  if (!deps.files) return error(503, "File storage isn't set up yet.");
  return { ...ctx, files: deps.files };
}

const publicFile = ({ pathname: _pathname, ...file }: StoredFile): AccountFile => file;

function usageOf(files: StoredFile[]) {
  return { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
}

/** The upload rule for a path in this account's folder, or null. */
function ruleFor(userId: string, pathname: string) {
  const parts = parseUploadPath(userId, pathname);
  if (!parts) return null;
  const contentType = fileTypeFor(`x.${parts.extension}`);
  return contentType ? { ...parts, contentType, maxBytes: MAX_FILE_BYTES } : null;
}

/**
 * GET: list files, plus storage use and upload mode.
 * GET ?id=: a short-lived link to read one file (blob mode).
 * GET ?id=&raw=1: the file's bytes (local mode).
 */
export async function getFiles(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  const id = params(request).get("id");

  if (!id) {
    const files = await ctx.scope.listFiles();
    return json({ files: files.map(publicFile), usage: usageOf(files), uploadMode: ctx.files.mode });
  }

  const file = await ctx.scope.getFile(id);
  if (!file) return error(404, "File not found.");

  if (ctx.files.mode === "blob") return json({ url: await ctx.files.readUrl(file.pathname) });

  const stored = await ctx.files.readLocal(file.pathname);
  if (!stored) return error(404, "File not found.");
  return new Response(new Uint8Array(stored.bytes), {
    headers: {
      "content-type": stored.contentType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * POST ?action=start {name, size}: reserve a path for a new upload. The
 * reservation counts against the quota (files and bytes) for 15 minutes, or
 * until the upload is confirmed.
 * POST ?action=sign: the Blob SDK asking for a presigned upload URL (blob mode);
 * only a reserved path is signed, for at most the size that was reserved.
 * POST ?action=confirm {pathname, name}: check what was uploaded and record it.
 */
export async function postFiles(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const action = params(request).get("action");
  const body = await readJson(request);
  const now = iso(deps.now());
  const accountId = ctx.userId;

  if (action === "start") {
    const name = cleanText(body?.name, FILE_NAME_MAX);
    const contentType = name ? fileTypeFor(name) : null;
    if (!name || !contentType) return error(400, "Upload a PDF, Word (.docx), PNG, JPEG or WebP file.");
    const size = typeof body?.size === "number" && Number.isFinite(body.size) ? Math.ceil(body.size) : 0;
    if (size <= 0) return error(400, "That file is empty.");
    if (size > MAX_FILE_BYTES) return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);

    // Uploads this account started earlier and never saved: their reservations are on record as
    // expired, so what was sent for them goes. (Best effort; the daily cleanup does the same and
    // then drops the records.)
    const abandoned = await ctx.scope.expiredUploads(iso(deps.now() - ABANDONED_AFTER_MS), ABANDONED_PER_REQUEST);
    if (abandoned.length) await ctx.files.delete(abandoned).catch(() => undefined);

    const extension = FILE_TYPES[contentType].extensions[0];
    const fileId = deps.newId();
    const pathname = uploadPath(ctx.userId, fileId, name, extension);
    try {
      await ctx.scope.reserveUpload(pathname, size, now, iso(deps.now() + UPLOAD_RESERVATION_MS));
    } catch (err) {
      if (!(err instanceof LimitReached)) throw err;
      securityEvent("file.rejected", { accountId, fileId, bytes: size, reason: `quota:${err.kind}` });
      return error(400, err.kind === "storage" ? STORAGE_FULL : TOO_MANY_FILES);
    }
    return json({ pathname, contentType, uploadMode: ctx.files.mode });
  }

  if (action === "sign") {
    if (ctx.files.mode !== "blob") return error(400, "Uploads go through /api/files in local mode.");
    const reserved = new Map((await ctx.scope.listReservations(now)).map((r) => [r.pathname, r]));
    let reason = "request";
    let signed: { fileId: string; bytes: number } | null = null;
    try {
      const result = await ctx.files.presignUpload(request, body, (pathname) => {
        const rule = ruleFor(ctx.userId, pathname);
        const reservation = reserved.get(pathname);
        reason = !rule ? "path" : "reservation";
        if (!rule || !reservation) return null;
        signed = { fileId: rule.fileId, bytes: Math.min(rule.maxBytes, reservation.declaredBytes) };
        return { contentType: rule.contentType, maxBytes: signed.bytes, validUntil: Date.parse(reservation.expiresAt) };
      });
      securityEvent("file.sign", { accountId, ...(signed ?? {}) });
      return json(result);
    } catch (err) {
      if (!(err instanceof UploadRefused)) throw err;
      securityEvent("file.sign.refused", { accountId, reason });
      return error(403, err.message);
    }
  }

  if (action === "confirm") {
    const pathname = typeof body?.pathname === "string" ? body.pathname : "";
    const rule = ruleFor(ctx.userId, pathname);
    const name = cleanText(body?.name, FILE_NAME_MAX);
    if (!rule || !name || fileTypeFor(name) !== rule.contentType) return error(400, "That upload can't be saved.");

    const saved = async () => (await ctx.scope.listFiles()).find((f) => f.pathname === pathname);
    const already = await saved();
    if (already) return json({ file: publicFile(already) });

    const refused = (reason: string, message: string, bytes: number | null = null) => {
      securityEvent("file.rejected", { accountId, fileId: rule.fileId, bytes, reason });
      return error(400, message);
    };
    /**
     * No live reservation (any more). Either another request for the same upload saved it a moment
     * ago, or its time ran out. Nothing is deleted here: an expired reservation stays on record,
     * and the cleanup deletes what was uploaded for it.
     */
    const noReservation = async (uploaded: boolean) => {
      const file = await saved();
      if (file) return json({ file: publicFile(file) });
      return refused("reservation", uploaded ? "That upload took too long. Please try again." : "That upload can't be saved.");
    };

    const reservation = (await ctx.scope.listReservations(now)).find((r) => r.pathname === pathname);
    const stored = await ctx.files.head(pathname);
    if (!reservation) return noReservation(stored !== null);
    if (!stored) return error(400, "The upload didn't finish. Please try again.");
    // Re-check what actually arrived. While the reservation is live nothing is recorded for this
    // path, so an upload that breaks the rules is removed right away.
    const problem =
      stored.size > Math.min(rule.maxBytes, reservation.declaredBytes)
        ? (["size", "That file is bigger than the one you picked. Please try again."] as const)
        : stored.contentType.split(";")[0].trim() !== rule.contentType
          ? (["type", "That file type isn't allowed."] as const)
          : null;
    if (problem) {
      await ctx.files.delete([pathname]);
      return refused(problem[0], problem[1], stored.size);
    }
    try {
      const file = await ctx.scope.saveUpload(rule.fileId, { pathname, name, contentType: rule.contentType, size: stored.size }, now);
      if (!file) return noReservation(true);
      securityEvent("file.confirmed", { accountId, fileId: file.id, bytes: file.size });
      return json({ file: publicFile(file) }, 201);
    } catch (err) {
      if (err instanceof LimitReached) return refused("quota:files", TOO_MANY_FILES, stored.size);
      return error(400, "That upload can't be saved."); // e.g. a reused file id
    }
  }

  return error(400, "Unknown action.");
}

/** PUT ?pathname=…: local mode only, the browser sends the file's bytes here (to a reserved path). */
export async function putFile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  if (ctx.files.mode !== "local") return error(400, "Upload straight to Blob storage.");
  const pathname = params(request).get("pathname") ?? "";
  const rule = ruleFor(ctx.userId, pathname);
  const reservation = rule ? (await ctx.scope.listReservations(iso(deps.now()))).find((r) => r.pathname === pathname) : undefined;
  if (!rule || !reservation) return error(403, "You can't upload to that location.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > Math.min(rule.maxBytes, reservation.declaredBytes)) {
    return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}, and no bigger than the file you picked.`);
  }
  await ctx.files.putLocal(pathname, { bytes, contentType: rule.contentType });
  return json({ ok: true });
}

/** DELETE ?id= */
export async function deleteFile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  const file = await ctx.scope.deleteFile(params(request).get("id") ?? "");
  if (!file) return error(404, "File not found.");
  await ctx.files.delete([file.pathname]);
  securityEvent("file.deleted", { accountId: ctx.userId, fileId: file.id });
  return json({ ok: true });
}
