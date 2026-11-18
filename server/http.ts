// Small helpers shared by the API handlers.

export const NAME_MAX = 24;

/**
 * A JSON response that is never cached. `headers` may repeat a name (an array
 * of pairs), which is how a response sets more than one cookie.
 */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const out = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  const extra = Array.isArray(headers) ? headers : headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of extra) {
    if (key.toLowerCase() === "set-cookie") out.append(key, value);
    else out.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers: out });
}

export const error = (status: number, message: string) => json({ error: message }, status);

const isJson = (request: Request) => (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";

/**
 * The request's JSON object, or null. Only `content-type: application/json` is
 * read: a browser can't send that from another site without a preflight, so a
 * cross-site form (text/plain, urlencoded, multipart) never reaches a handler.
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!isJson(request)) return null;
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Trim and collapse spaces; letters, numbers, spaces, - ' . only. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > NAME_MAX) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) return null;
  return name;
}

/** A cookie's value, or null when it's missing or isn't valid percent-encoding. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // e.g. "%E0%A4%A": treated like no cookie at all
    }
  }
  return null;
}

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

/** An HttpOnly, same-site cookie (Secure over HTTPS); maxAge 0 clears it. */
export function cookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${maxAgeSeconds}`, "HttpOnly", "SameSite=Lax"];
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

// ------------------------------------------------------------ Origin check

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The origins this request was itself addressed to (as the browser saw the site). */
function ownOrigins(request: Request): Set<string> {
  const url = new URL(request.url);
  const origins = new Set([url.origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
    try {
      origins.add(new URL(`${proto}://${host}`).origin);
    } catch {
      // an unparseable Host header adds nothing
    }
  }
  return origins;
}

/**
 * Refuses a state-changing request that a browser sent from another site.
 * Browsers attach `Origin` to every cross-site POST/PUT/PATCH/DELETE, so when
 * it's present it must be this site (or one of `allowed`). Requests without
 * an Origin (scripts, server-to-server) carry no ambient browser cookies that
 * weren't theirs to begin with, and pass.
 * Returns the 403 to send, or null to carry on.
 */
export function requireSameOrigin(request: Request, allowed: readonly string[] = []): Response | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  if (ownOrigins(request).has(origin) || allowed.includes(origin)) return null;
  return error(403, "This request came from another site.");
}
