// Helpers shared by the handler tests.

import { vi } from "vitest";
import type { Deps } from "./deps.js";
import { submitScore } from "./handlers.js";

/** Every cookie a response sets, as a request's Cookie header: "a=1; b=2". */
export const cookiesFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** One cookie a response sets ("name=value"), or undefined. */
export const cookieNamed = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${name}=`));

/** A started session as the browser holds it: its cookies and the tag every score save must carry. */
export interface Playing {
  cookie: string;
  sessionTag: string;
}

/** Reads a POST /api/session answer. `extraCookies` are ones the browser already had (e.g. the kid device cookie). */
export async function playing(res: Response, extraCookies = ""): Promise<Playing> {
  const { sessionTag } = (await res.clone().json()) as { sessionTag: string };
  return { cookie: [cookiesFrom(res), extraCookies].filter(Boolean).join("; "), sessionTag };
}

let batches = 0;

/** POST /api/score the way the app does: with the session tag and a fresh batch id (unless one is given). */
export function score(deps: Deps, who: Playing, body: Record<string, unknown>, base = "https://quizzlet.test"): Promise<Response> {
  const request = new Request(`${base}/api/score`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: who.cookie },
    body: JSON.stringify({ batchId: `test-batch-${++batches}`, sessionTag: who.sessionTag, leaderboard: false, ...body }),
  });
  return submitScore(request, deps);
}

export interface LoggedEvent {
  event: string;
  [field: string]: unknown;
}

/**
 * Captures the security log (JSON lines on console.info) for one test.
 * `lines` is the raw text, to check nothing secret was written.
 */
export function captureLog() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const events = (): LoggedEvent[] => lines.map((line) => JSON.parse(line) as LoggedEvent).filter((e) => e.kind === "security");
  return {
    lines,
    events,
    named: (event: string) => events().filter((e) => e.event === event),
    restore: () => spy.mockRestore(),
  };
}
