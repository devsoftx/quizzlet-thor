// Small helpers shared by the API handlers.

export { cleanName, NAME_MAX } from "./names.js";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export const error = (status: number, message: string, headers: HeadersInit = {}) => json({ error: message }, status, headers);

/** True when the request says its body is JSON (with or without a charset). */
export function isJsonRequest(request: Request): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "");
}

/**
 * The JSON object in the body, or null. Only `application/json` bodies are
 * read: a form on another site can't send that type without the browser
 * asking this server first.
 */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!isJsonRequest(request)) return null;
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // a value that isn't valid percent-encoding is no cookie of ours
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

/**
 * True unless the browser says the request comes from another origin. A
 * request with no Origin header (not sent by a page, or a same-origin GET)
 * passes; when the header is there it must name this site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const url = new URL(request.url);
  if (origin === url.origin) return true;
  // Behind the platform's proxy the public host and scheme arrive in headers.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return host !== null && origin === `${proto}://${host}`;
}

/**
 * The caller's IP address as the platform reports it, or null when there is
 * none (local development). Vercel sets `x-real-ip` itself and overwrites
 * whatever the client sent, so it can't be forged there.
 */
export function clientIp(request: Request): string | null {
  const ip = request.headers.get("x-real-ip")?.trim();
  return ip ? ip : null;
}
