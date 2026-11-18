// The response headers the deployment sends (vercel.json), and the ones the
// API answers set themselves. The end-to-end suite checks them on the wire.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSession } from "./handlers.js";
import { MemoryStore } from "./store.js";

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { headers: HeaderRule[] };

/** The headers a path gets, by lowercase name. */
function headersFor(pathname: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const rule of config.headers) {
    if (!new RegExp(`^${rule.source}$`).test(pathname)) continue;
    for (const { key, value } of rule.headers) found[key.toLowerCase()] = value;
  }
  return found;
}

const directives = (policy: string) =>
  Object.fromEntries(policy.split(";").map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));

describe("response headers", () => {
  it("are sent for the app, its files and every API route", () => {
    for (const pathname of ["/", "/index.html", "/assets/index-abc.js", "/images/field-fern-moth.png", "/api/session", "/api/files"]) {
      expect(headersFor(pathname), pathname).toMatchObject({
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-frame-options": "DENY",
        // Enforced from day one: the page can't be framed by another site.
        "content-security-policy": "frame-ancestors 'none'",
        "content-security-policy-report-only": expect.stringContaining("default-src 'self'"),
      });
    }
  });

  it("the content policy (report-only for now) allows this app, Clerk and Blob uploads, and nothing loose", () => {
    const policy = directives(headersFor("/")["content-security-policy-report-only"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);

    // Scripts: our own files and Clerk's; never inline or eval.
    expect(policy["script-src"]).toContain("'self'");
    expect(policy["script-src"]).toContain("https://challenges.cloudflare.com");
    expect(policy["script-src"].some((source) => source.endsWith(".clerk.accounts.dev"))).toBe(true);
    for (const loose of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:", "blob:"]) {
      expect(policy["script-src"], loose).not.toContain(loose);
    }
    // Clerk styles its components at run time; uploads go straight to Blob storage.
    expect(policy["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["'self'", "https://vercel.com"]));
    expect(policy["img-src"]).toEqual(expect.arrayContaining(["'self'", "data:", "https://img.clerk.com"]));
    expect(policy["worker-src"]).toEqual(["'self'", "blob:"]);
    for (const sources of Object.values(policy)) expect(sources).not.toContain("*");
  });

  it("API answers say what they are and are never cached", async () => {
    const res = await getSession(new Request("https://localhost/api/session"), { store: new MemoryStore(), now: () => 0, newId: () => "x" });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
