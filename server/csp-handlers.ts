// /api/csp-report: where browsers send Content-Security-Policy violation
// reports (see vercel.json). Each report becomes one log line, so the policy
// can be checked against real traffic before it is enforced.
//
// Anyone can post here, so only a few short, well-formed fields are kept:
// the directive, the blocked origin (never a full URL) and the page's path.

import { securityEvent } from "./log.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS = 5;
const REPORT_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"]);

const word = (value: unknown, max: number) => (typeof value === "string" && new RegExp(`^[a-z0-9-]{1,${max}}$`, "i").test(value) ? value.toLowerCase() : null);

/** "https://evil.example/x.js?token=1" -> "https://evil.example"; keywords ("inline", "eval", "data") as they are. */
function blockedSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.origin === "null" ? `${url.protocol}` : url.origin;
  } catch {
    return word(value, 32);
  }
}

function pagePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return null;
  }
}

/** POST: accepts both report formats (report-uri and the Reporting API). Always answers 204. */
export async function cspReport(request: Request): Promise<Response> {
  const done = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!REPORT_TYPES.has(type) || Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return done();

  let parsed: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return done();
    parsed = JSON.parse(text);
  } catch {
    return done();
  }

  const reports = (Array.isArray(parsed) ? parsed : [parsed]).slice(0, MAX_REPORTS);
  for (const entry of reports) {
    if (!entry || typeof entry !== "object") continue;
    const outer = entry as Record<string, unknown>;
    // report-uri: {"csp-report": {...}}; Reporting API: {type: "csp-violation", body: {...}}
    const report = (outer["csp-report"] ?? (outer.type === "csp-violation" ? outer.body : null)) as Record<string, unknown> | null;
    if (!report || typeof report !== "object") continue;
    const directive = word(report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"], 40);
    if (!directive) continue;
    securityEvent("csp.violation", {
      directive,
      blocked: blockedSource(report["blocked-uri"] ?? report.blockedURL),
      path: pagePath(report["document-uri"] ?? report.documentURL),
      disposition: word(report.disposition, 10),
    });
  }
  return done();
}
