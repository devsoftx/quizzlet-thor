// /api/decks and /api/files: a signed-in parent's private decks and files.
// Like the profile routes, everything goes through requireAccount, so data is
// only reached via accounts.forAccount(<the verified user id>).

import { parseDeck, titleFromFileName } from "../src/deck.js";
import {
  FILE_TYPES,
  fileTypeFor,
  MAX_DECK_BYTES,
  MAX_DECKS,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_FILE_BYTES,
  type AccountFile,
  type AccountScope,
  type DeckPatch,
  type PendingUpload,
  type StoredFile,
} from "./accounts.js";
import { ensureAccount, requireAccount, type AccountContext } from "./account-handlers.js";
import type { Deps } from "./deps.js";
import { parseUploadPath, UploadRefused, uploadPath, type FileStore } from "./files.js";
import { error, json, readJson } from "./http.js";
import { noLog } from "./log.js";
import { route } from "./route.js";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 300;
const FILE_NAME_MAX = 120;

/** A started upload holds its room in the quota this long; then it must be started again. */
export const UPLOAD_PENDING_MS = 15 * 60 * 1000;
/**
 * How long after that before the reservation and anything stored for it are
 * removed. An upload link stops working when the reservation ends, so by then
 * nothing can still be arriving.
 */
export const UPLOAD_SWEEP_GRACE_MS = 60 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();

const params = (request: Request) => new URL(request.url).searchParams;
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

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

export const listDecks = route({ name: "decks.list" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return json({ decks: await ctx.scope.listDecks() });
});

const TOO_MANY_DECKS = `You can keep up to ${MAX_DECKS} decks.`;

/** POST {fileName?, yaml, profileIds?}: save a valid deck to the account. */
export const createDeck = route({ name: "decks.create" }, async (request, deps) => {
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

  const deck = await ctx.scope.createDeck(deps.newId(), {
    title: cleanText(parsed.deck.title, TITLE_MAX) ?? titleFromFileName(fileName).slice(0, TITLE_MAX),
    description: cleanText(parsed.deck.description, DESCRIPTION_MAX),
    cardCount: parsed.deck.cards.length,
    yaml,
    // A saved deck is on until the parent turns it off; the file's own
    // `enabled` flag is for the shared decks/ folder.
    enabled: true,
    profileIds,
  });
  // The check above answers early; the insert itself enforces the limit.
  if (!deck) return error(400, TOO_MANY_DECKS);
  return json({ deck }, 201);
});

/** PATCH ?id= {title?, enabled?, profileIds?} */
export const updateDeck = route({ name: "decks.update" }, async (request, deps) => {
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
});

export const deleteDeck = route({ name: "decks.delete" }, async (request, deps) => {
  const ctx = await requireAccount(request, deps);
  if (ctx instanceof Response) return ctx;
  return (await ctx.scope.deleteDeck(params(request).get("id") ?? ""))
    ? json({ ok: true })
    : error(404, "Deck not found.");
});

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

/** Why `size` more bytes can't be added to what's in use, or null if they fit. */
function quotaProblem(usage: { count: number; bytes: number }, size: number): string | null {
  if (usage.count >= MAX_FILES) return `You can keep up to ${MAX_FILES} files. Delete one to make room.`;
  if (usage.bytes + size > MAX_TOTAL_FILE_BYTES) {
    return `That would go over your ${mb(MAX_TOTAL_FILE_BYTES)} of file storage. Delete a file to make room.`;
  }
  return null;
}

/** The upload rule for a path in this account's folder, or null. */
function ruleFor(userId: string, pathname: string) {
  const parts = parseUploadPath(userId, pathname);
  if (!parts) return null;
  const contentType = fileTypeFor(`x.${parts.extension}`);
  return contentType ? { ...parts, contentType, maxBytes: MAX_FILE_BYTES } : null;
}

/**
 * The started upload a path belongs to, while its reservation lasts. Bytes may
 * only go to a path that `start` handed out and that still holds room in the quota.
 */
async function liveUpload(ctx: FileContext, pathname: string, now: number): Promise<PendingUpload | null> {
  const rule = ruleFor(ctx.userId, pathname);
  if (!rule) return null;
  const pending = await ctx.scope.getUpload(rule.fileId);
  return pending && pending.pathname === pathname && Date.parse(pending.expiresAt) > now ? pending : null;
}

/** Removes reservations that ran out a while ago, and whatever was stored for them. */
async function sweepUploads(ctx: FileContext, now: number): Promise<void> {
  const stale = await ctx.scope.expiredUploads(iso(now - UPLOAD_SWEEP_GRACE_MS));
  if (stale.length === 0) return;
  // Stored bytes first: if that fails, the records are still there for the next sweep.
  await ctx.files.delete(stale.map((upload) => upload.pathname));
  for (const upload of stale) await ctx.scope.deleteFile(upload.id);
}

/**
 * GET: list files, plus storage use and upload mode.
 * GET ?id=: a short-lived link to read one file (blob mode).
 * GET ?id=&raw=1: the file's bytes (local mode).
 */
export const getFiles = route({ name: "files.get" }, async (request, deps) => {
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
});

/**
 * POST ?action=start {name, size}: reserve a path, and room in the quota, for a new upload.
 * POST ?action=sign: the Blob SDK asking for a presigned upload URL (blob mode).
 * POST ?action=confirm {pathname, name}: check what was uploaded and save it.
 *
 * The quota counts an upload from `start`, not from `confirm`: the reservation
 * holds the declared size for UPLOAD_PENDING_MS, upload links are only made for
 * a path with a live reservation, and nothing bigger than declared is kept.
 */
export const postFiles = route({ name: "files.post" }, async (request, deps) => {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const action = params(request).get("action");
  const body = await readJson(request);
  const now = deps.now();
  const refused = (stage: string, reason: string) => (deps.log ?? noLog)({ event: "upload.refused", account: ctx.userId, stage, reason });

  if (action === "start") {
    const name = cleanText(body?.name, FILE_NAME_MAX);
    const contentType = name ? fileTypeFor(name) : null;
    if (!name || !contentType) return error(400, "Upload a PDF, Word (.docx), PNG, JPEG or WebP file.");
    const size = body?.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return error(400, "That file is empty.");
    if (size > MAX_FILE_BYTES) return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);

    await sweepUploads(ctx, now);
    const extension = FILE_TYPES[contentType].extensions[0];
    const fileId = deps.newId();
    const pathname = uploadPath(ctx.userId, fileId, name, extension);
    const reserved = await ctx.scope.startUpload(fileId, { pathname, name, contentType, size }, iso(now), iso(now + UPLOAD_PENDING_MS));
    if (!reserved) {
      refused("start", "quota");
      const problem = quotaProblem(await ctx.scope.fileUsage(iso(now)), size);
      return error(400, problem ?? "There isn't room for that file right now. Please try again.");
    }
    return json({ pathname, contentType, uploadMode: ctx.files.mode });
  }

  if (action === "sign") {
    if (ctx.files.mode !== "blob") return error(400, "Uploads go through /api/files in local mode.");
    try {
      const result = await ctx.files.presignUpload(request, body, async (pathname) => {
        const pending = await liveUpload(ctx, pathname, now);
        if (!pending) return null;
        // No more than was declared, and no later than the reservation lasts.
        return { contentType: pending.contentType, maxBytes: pending.size, validUntil: Date.parse(pending.expiresAt) };
      });
      return json(result);
    } catch (err) {
      if (err instanceof UploadRefused) {
        refused("sign", "not_allowed");
        return error(403, err.message);
      }
      throw err;
    }
  }

  if (action === "confirm") {
    const pathname = typeof body?.pathname === "string" ? body.pathname : "";
    const rule = ruleFor(ctx.userId, pathname);
    const name = cleanText(body?.name, FILE_NAME_MAX);
    if (!rule || !name || fileTypeFor(name) !== rule.contentType) return error(400, "That upload can't be saved.");

    const already = await ctx.scope.getFile(rule.fileId);
    if (already) return already.pathname === pathname ? json({ file: publicFile(already) }) : error(400, "That upload can't be saved.");

    const pending = await ctx.scope.getUpload(rule.fileId);
    if (!pending || pending.pathname !== pathname) return error(400, "That upload can't be saved.");
    /** Drops the reservation and anything stored for it. */
    const discard = async (reason: string, message: string) => {
      refused("confirm", reason);
      await ctx.files.delete([pathname]);
      await ctx.scope.deleteFile(pending.id);
      return error(400, message);
    };
    if (Date.parse(pending.expiresAt) <= now) return discard("expired", "The upload took too long. Please try again.");

    const stored = await ctx.files.head(pathname);
    if (!stored) return error(400, "The upload didn't finish. Please try again.");
    // Re-check what actually arrived; remove it if it breaks the rules.
    if (stored.size > rule.maxBytes) return discard("too_large", `Files can be up to ${mb(MAX_FILE_BYTES)}.`);
    if (stored.contentType.split(";")[0].trim() !== rule.contentType) return discard("wrong_type", "That file type isn't allowed.");
    // The quota holds room for the declared size only.
    if (stored.size > pending.size) return discard("larger_than_declared", "That file is bigger than expected. Please try again.");

    const file = await ctx.scope.completeUpload(pending.id, { name, size: stored.size }, iso(now));
    if (!file) return error(400, "That upload can't be saved.");
    return json({ file: publicFile(file) }, 201);
  }

  return error(400, "Unknown action.");
});

/** PUT ?pathname=…: local mode only, the browser sends the file's bytes here. */
export const putFile = route({ name: "files.put", body: "raw" }, async (request, deps) => {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  if (ctx.files.mode !== "local") return error(400, "Upload straight to Blob storage.");
  const pathname = params(request).get("pathname") ?? "";
  const pending = await liveUpload(ctx, pathname, deps.now());
  if (!pending) {
    (deps.log ?? noLog)({ event: "upload.refused", account: ctx.userId, stage: "put", reason: "not_allowed" });
    return error(403, "You can't upload to that location.");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);
  if (bytes.byteLength > pending.size) return error(400, "That file is bigger than expected. Please try again.");
  await ctx.files.putLocal(pathname, { bytes, contentType: pending.contentType });
  return json({ ok: true });
});

/** DELETE ?id= */
export const deleteFile = route({ name: "files.delete" }, async (request, deps) => {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  const file = await ctx.scope.deleteFile(params(request).get("id") ?? "");
  if (!file) return error(404, "File not found.");
  await ctx.files.delete([file.pathname]);
  return json({ ok: true });
});
