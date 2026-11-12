// Private file storage. Production: a private Vercel Blob store (the browser
// uploads straight to it with a short-lived URL signed for one exact path).
// Local dev and tests: memory. Each account's files live under its own folder,
// and only the server decides which paths a signed-in parent may write or read.

import { BlobNotFoundError, del, head, issueSignedToken, list, presignUrl } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { createHash } from "node:crypto";

/** What may be uploaded to one path. */
export interface UploadRule {
  contentType: string;
  maxBytes: number;
}

export interface StoredBytes {
  bytes: Uint8Array;
  contentType: string;
}

export interface FileStore {
  /** "blob": the browser uploads to Vercel Blob; "local": it sends the bytes to /api/files. */
  readonly mode: "blob" | "local";
  /**
   * Answers the Blob SDK's request for a presigned upload URL. `rule` returns
   * what may go at the requested path, or null to refuse it.
   */
  presignUpload(request: Request, body: unknown, rule: (pathname: string) => UploadRule | null): Promise<unknown>;
  /** Local mode only: keep uploaded bytes in memory. */
  putLocal(pathname: string, data: StoredBytes): Promise<void>;
  /** Local mode only. */
  readLocal(pathname: string): Promise<StoredBytes | null>;
  /** Size and type of what was actually uploaded, or null if nothing is there. */
  head(pathname: string): Promise<{ size: number; contentType: string } | null>;
  /** Blob mode: a link that reads the file for a few minutes. */
  readUrl(pathname: string): Promise<string>;
  delete(pathnames: string[]): Promise<void>;
  /** Removes everything under a folder (used when an account is deleted). */
  deletePrefix(prefix: string): Promise<void>;
}

export class UploadRefused extends Error {}

// ------------------------------------------------------------------- Paths

/** The folder for one account. Clerk ids are already path-safe; anything else is hashed. */
export function accountFolder(userId: string): string {
  const segment = /^[A-Za-z0-9_-]{1,64}$/.test(userId)
    ? userId
    : createHash("sha256").update(userId).digest("hex").slice(0, 32);
  return `users/${segment}/`;
}

/** ASCII-only file name for the storage path (the display name is kept separately). */
export function storageName(name: string, extension: string): string {
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "file"}.${extension}`;
}

/** `users/<account>/uploads/<fileId>/<name>.<ext>` */
export function uploadPath(userId: string, fileId: string, name: string, extension: string): string {
  return `${accountFolder(userId)}uploads/${fileId}/${storageName(name, extension)}`;
}

/** Splits an upload path that belongs to `userId`; null for anything else. */
export function parseUploadPath(userId: string, pathname: string): { fileId: string; extension: string } | null {
  const folder = accountFolder(userId);
  if (!pathname.startsWith(`${folder}uploads/`)) return null;
  const rest = pathname.slice(folder.length + "uploads/".length);
  const m = /^([A-Za-z0-9-]{1,64})\/[A-Za-z0-9_-]{1,60}\.([a-z0-9]{2,5})$/.exec(rest);
  return m ? { fileId: m[1], extension: m[2] } : null;
}

// ------------------------------------------------------------------ Memory

export class MemoryFileStore implements FileStore {
  readonly mode = "local" as const;
  private files = new Map<string, StoredBytes>();

  async presignUpload(): Promise<unknown> {
    throw new UploadRefused("Uploads go through /api/files in local mode.");
  }
  async putLocal(pathname: string, data: StoredBytes) {
    this.files.set(pathname, { bytes: new Uint8Array(data.bytes), contentType: data.contentType });
  }
  async readLocal(pathname: string) {
    return this.files.get(pathname) ?? null;
  }
  async head(pathname: string) {
    const f = this.files.get(pathname);
    return f ? { size: f.bytes.byteLength, contentType: f.contentType } : null;
  }
  async readUrl(): Promise<string> {
    throw new Error("No direct links in local mode.");
  }
  async delete(pathnames: string[]) {
    for (const p of pathnames) this.files.delete(p);
  }
  async deletePrefix(prefix: string) {
    for (const p of [...this.files.keys()]) if (p.startsWith(prefix)) this.files.delete(p);
  }
  /** For tests. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

// -------------------------------------------------------------------- Blob

const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const READ_WINDOW_MS = 5 * 60 * 1000;

export class BlobFileStore implements FileStore {
  readonly mode = "blob" as const;

  async presignUpload(request: Request, body: unknown, rule: (pathname: string) => UploadRule | null) {
    const event = body as HandleUploadPresignedBody | null;
    // We never ask Blob to call us back, so the only valid request is for an upload URL.
    if (event?.type !== "blob.generate-presigned-url") throw new UploadRefused("Unexpected upload request.");
    return handleUploadPresigned({
      request,
      body: event,
      // Only checks completion callbacks, which are refused above.
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY ?? "unused",
      getSignedToken: async (pathname, _clientPayload, multipart) => {
        const allowed = rule(pathname);
        if (!allowed || multipart) throw new UploadRefused("You can't upload to that location.");
        const validUntil = Date.now() + UPLOAD_WINDOW_MS;
        const limits = { allowedContentTypes: [allowed.contentType], maximumSizeInBytes: allowed.maxBytes };
        const token = await issueSignedToken({ pathname, operations: ["put"], validUntil, ...limits });
        return { token, urlOptions: { ...limits, validUntil, allowOverwrite: false, addRandomSuffix: false } };
      },
    });
  }

  async putLocal(): Promise<void> {
    throw new UploadRefused("Uploads go straight to Blob storage.");
  }
  async readLocal() {
    return null;
  }

  async head(pathname: string) {
    try {
      const h = await head(pathname);
      return { size: h.size, contentType: h.contentType };
    } catch (err) {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    }
  }

  async readUrl(pathname: string) {
    const validUntil = Date.now() + READ_WINDOW_MS;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private", validUntil });
    return presignedUrl;
  }

  async delete(pathnames: string[]) {
    if (pathnames.length) await del(pathnames);
  }

  async deletePrefix(prefix: string) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
}

// ----------------------------------------------------------------- Factory

const globalState = globalThis as typeof globalThis & { __quizzletMemoryFiles?: MemoryFileStore };

/** Blob when a store is connected; memory locally; null on Vercel without one. */
export function getFileStore(env: Record<string, string | undefined> = process.env): FileStore | null {
  if (env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN) return new BlobFileStore();
  if (env.VERCEL) return null;
  return (globalState.__quizzletMemoryFiles ??= new MemoryFileStore());
}
