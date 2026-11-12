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
  type StoredFile,
} from "./accounts.js";
import { ensureAccount, requireAccount, type AccountContext } from "./account-handlers.js";
import { defaultDeps, type Deps } from "./deps.js";
import { parseUploadPath, UploadRefused, uploadPath, type FileStore } from "./files.js";
import { error, json, readJson } from "./http.js";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 300;
const FILE_NAME_MAX = 120;

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
  if ((await ctx.scope.listDecks()).length >= MAX_DECKS) return error(400, `You can keep up to ${MAX_DECKS} decks.`);

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
  return (await ctx.scope.deleteDeck(params(request).get("id") ?? ""))
    ? json({ ok: true })
    : error(404, "Deck not found.");
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

/** Why `size` more bytes can't be added, or null if they fit. */
function quotaProblem(files: StoredFile[], size: number): string | null {
  const usage = usageOf(files);
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
 * POST ?action=start {name, size}: reserve a path for a new upload.
 * POST ?action=sign: the Blob SDK asking for a presigned upload URL (blob mode).
 * POST ?action=confirm {pathname, name}: check what was uploaded and record it.
 */
export async function postFiles(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  await ensureAccount(ctx, deps);
  const action = params(request).get("action");
  const body = await readJson(request);

  if (action === "start") {
    const name = cleanText(body?.name, FILE_NAME_MAX);
    const contentType = name ? fileTypeFor(name) : null;
    if (!name || !contentType) return error(400, "Upload a PDF, Word (.docx), PNG, JPEG or WebP file.");
    const size = body?.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return error(400, "That file is empty.");
    if (size > MAX_FILE_BYTES) return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);
    const problem = quotaProblem(await ctx.scope.listFiles(), size);
    if (problem) return error(400, problem);

    const extension = FILE_TYPES[contentType].extensions[0];
    const pathname = uploadPath(ctx.userId, deps.newId(), name, extension);
    return json({ pathname, contentType, uploadMode: ctx.files.mode });
  }

  if (action === "sign") {
    if (ctx.files.mode !== "blob") return error(400, "Uploads go through /api/files in local mode.");
    const files = await ctx.scope.listFiles();
    try {
      const result = await ctx.files.presignUpload(request, body, (pathname) => {
        if (quotaProblem(files, 0)) return null;
        const rule = ruleFor(ctx.userId, pathname);
        return rule ? { contentType: rule.contentType, maxBytes: rule.maxBytes } : null;
      });
      return json(result);
    } catch (err) {
      if (err instanceof UploadRefused) return error(403, err.message);
      throw err;
    }
  }

  if (action === "confirm") {
    const pathname = typeof body?.pathname === "string" ? body.pathname : "";
    const rule = ruleFor(ctx.userId, pathname);
    const name = cleanText(body?.name, FILE_NAME_MAX);
    if (!rule || !name || fileTypeFor(name) !== rule.contentType) return error(400, "That upload can't be saved.");

    const files = await ctx.scope.listFiles();
    const already = files.find((f) => f.pathname === pathname);
    if (already) return json({ file: publicFile(already) });

    const stored = await ctx.files.head(pathname);
    if (!stored) return error(400, "The upload didn't finish. Please try again.");
    // Re-check what actually arrived; remove it if it breaks the rules.
    const problem =
      stored.size > rule.maxBytes
        ? `Files can be up to ${mb(MAX_FILE_BYTES)}.`
        : stored.contentType.split(";")[0].trim() !== rule.contentType
          ? "That file type isn't allowed."
          : quotaProblem(files, stored.size);
    if (problem) {
      await ctx.files.delete([pathname]);
      return error(400, problem);
    }
    try {
      const file = await ctx.scope.createFile(rule.fileId, { pathname, name, contentType: rule.contentType, size: stored.size });
      return json({ file: publicFile(file) }, 201);
    } catch {
      return error(400, "That upload can't be saved."); // e.g. a reused file id
    }
  }

  return error(400, "Unknown action.");
}

/** PUT ?pathname=…: local mode only, the browser sends the file's bytes here. */
export async function putFile(request: Request, deps: Deps = defaultDeps()): Promise<Response> {
  const ctx = await requireFiles(request, deps);
  if (ctx instanceof Response) return ctx;
  if (ctx.files.mode !== "local") return error(400, "Upload straight to Blob storage.");
  const pathname = params(request).get("pathname") ?? "";
  const rule = ruleFor(ctx.userId, pathname);
  if (!rule) return error(403, "You can't upload to that location.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > rule.maxBytes) return error(400, `Files can be up to ${mb(MAX_FILE_BYTES)}.`);
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
  return json({ ok: true });
}
