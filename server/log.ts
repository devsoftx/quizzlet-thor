// Security event log: one JSON line per event, written to the function's
// output (Vercel runtime logs; a log drain keeps them longer).
//
// Rule: ids and outcomes only. Never pass a token, cookie, invitation secret,
// file content, display name or kid nickname to securityEvent().

import { createHash } from "node:crypto";

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function securityEvent(event: string, fields: LogFields = {}): void {
  // The envelope (ts, kind, event) is written last, so a field can never replace it.
  console.info(JSON.stringify({ ...fields, ts: new Date().toISOString(), kind: "security", event }));
}

/** A stable stand-in for a session id, so one session's events can be grouped without logging its cookie. */
export const sessionHash = (id: string) => createHash("sha256").update(`log:${id}`).digest("hex").slice(0, 16);

/** The request's path without its query string (ids in queries are logged as their own fields). */
export const routeOf = (request: Request) => new URL(request.url).pathname;

/** An error's class name; its message may hold user data, so it is never logged. */
export const errorName = (err: unknown) => (err instanceof Error ? err.name || err.constructor.name : typeof err);
