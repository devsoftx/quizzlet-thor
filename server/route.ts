// What every API route does before its own work: refuse state-changing
// requests from other sites, refuse non-JSON bodies, apply the per-IP rate
// limit of the routes anyone can call, and log errors nobody handled.

import { createHash } from "node:crypto";
import { defaultDeps, type Deps } from "./deps.js";
import { clientIp, error, isJsonRequest, isSameOrigin } from "./http.js";
import { noLog } from "./log.js";

/**
 * Requests allowed per IP address, per minute, on the routes that need no
 * sign-in. Sized for a classroom behind one address (30 kids answering every
 * few seconds); a single session's pace is capped separately in the store.
 */
export const RATE_LIMITS = {
  session: { max: 60, windowSeconds: 60 },
  score: { max: 900, windowSeconds: 60 },
  leaderboard: { max: 300, windowSeconds: 60 },
  kid: { max: 30, windowSeconds: 60 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RouteOptions {
  /** A short name for the logs, e.g. "session.start". */
  name: string;
  /** The per-IP limit this route counts against. */
  limit?: RateLimitName;
  /** "json" (the default): a body must be JSON. "raw": any bytes (the local file upload). */
  body?: "json" | "raw";
}

export type RouteHandler = (request: Request, deps: Deps) => Promise<Response>;

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Addresses are counted by fingerprint, so none is kept in the store. */
const ipKey = (ip: string) => createHash("sha256").update(`rate:${ip}`).digest("hex").slice(0, 32);

async function overLimit(request: Request, deps: Deps, options: RouteOptions): Promise<Response | null> {
  const ip = clientIp(request);
  if (!options.limit || !deps.store || !ip) return null;
  const { max, windowSeconds } = RATE_LIMITS[options.limit];
  let hits: { count: number; resetAt: number };
  try {
    hits = await deps.store.hit(`${options.limit}:${ipKey(ip)}`, windowSeconds * 1000, deps.now());
  } catch {
    return null; // the limiter must never be what takes the site down
  }
  if (hits.count <= max) return null;
  (deps.log ?? noLog)({ event: "rate_limit.exceeded", route: options.name, limit: options.limit });
  const retryAfter = Math.max(1, Math.ceil((hits.resetAt - deps.now()) / 1000));
  return error(429, "Too many requests. Please wait a minute and try again.", { "retry-after": String(retryAfter) });
}

/** Wraps a handler with the checks above. Tests call the result with their own `deps`. */
export function route(options: RouteOptions, handler: RouteHandler) {
  return async (request: Request, deps: Deps = defaultDeps()): Promise<Response> => {
    const log = deps.log ?? noLog;
    try {
      if (STATE_CHANGING.has(request.method)) {
        if (!isSameOrigin(request)) {
          log({ event: "request.refused", route: options.name, reason: "cross_origin" });
          return error(403, "This request came from another site.");
        }
        // No content type at all means no body we would read (see readJson).
        if (options.body !== "raw" && request.headers.has("content-type") && !isJsonRequest(request)) {
          log({ event: "request.refused", route: options.name, reason: "content_type" });
          return error(415, "Send the request body as JSON.");
        }
      }
      const limited = await overLimit(request, deps, options);
      if (limited) return limited;
      return await handler(request, deps);
    } catch (err) {
      // The platform still answers 500 and records the stack; this adds a searchable event.
      log({ event: "error.unhandled", route: options.name, method: request.method, error: err instanceof Error ? err.name : "unknown" });
      throw err;
    }
  };
}
