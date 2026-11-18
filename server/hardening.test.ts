// Request and response hardening: the cross-site check on every write, the
// JSON-only body rule, the response headers, CSP reports and operator flags.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteKidRoute, POST as postKidRoute } from "../api/kid.js";
import { POST as cspReportRoute } from "../api/csp-report.js";
import { GET as getSessionRoute, POST as postSessionRoute } from "../api/session.js";
import { splitSql } from "../scripts/sql-split.mjs";
import { cspReport } from "./csp-handlers.js";
import { DEFAULT_FLAGS, flagReader, foldName, isBlockedName, parseFlags } from "./flags.js";
import { json, readCookie, readJson, requireSameOrigin } from "./http.js";
import { withErrors } from "./route.js";
import { captureLog } from "./test-support.js";

const SITE = "https://quizzlet.example";

let log: ReturnType<typeof captureLog>;
beforeEach(() => {
  log = captureLog();
});
afterEach(() => log.restore());

const request = (method: string, headers: Record<string, string> = {}, url = `${SITE}/api/session`, body?: string) =>
  new Request(url, { method, headers, body });

describe("cross-site requests", () => {
  it("lets same-origin writes and requests without an Origin through", () => {
    expect(requireSameOrigin(request("POST", { origin: SITE }))).toBeNull();
    expect(requireSameOrigin(request("POST"))).toBeNull(); // scripts and server-to-server calls send no Origin
    expect(requireSameOrigin(request("GET", { origin: "https://evil.example" }))).toBeNull(); // reads change nothing
  });

  it("refuses a write from any other origin", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const origin of ["https://evil.example", "http://quizzlet.example", "https://quizzlet.example.evil.example", "https://sub.quizzlet.example", "null"]) {
        const refused = requireSameOrigin(request(method, { origin }));
        expect(refused?.status, `${method} from ${origin}`).toBe(403);
      }
    }
    expect(await requireSameOrigin(request("POST", { origin: "https://evil.example" }))!.json()).toEqual({ error: "This request came from another site." });
  });

  it("knows the site by the host the browser used, behind a proxy too", () => {
    // The function sees an internal URL; the forwarded headers say what the visitor's browser asked for.
    const proxied = (origin: string) =>
      request("POST", { origin, "x-forwarded-host": "quizzlet.example", "x-forwarded-proto": "https" }, "http://127.0.0.1:3000/api/session");
    expect(requireSameOrigin(proxied(SITE))).toBeNull();
    expect(requireSameOrigin(proxied("https://evil.example"))?.status).toBe(403);
    // Local development: plain http on a port.
    expect(requireSameOrigin(request("POST", { origin: "http://localhost:5181", host: "localhost:5181" }, "http://localhost:5181/api/session"))).toBeNull();
  });

  it("also accepts the deployment's own listed origins", () => {
    const fromPreview = request("POST", { origin: "https://quizzlet-git-branch.vercel.app" });
    expect(requireSameOrigin(fromPreview)?.status).toBe(403);
    expect(requireSameOrigin(fromPreview, ["https://quizzlet-git-branch.vercel.app"])).toBeNull();
  });

  it("is applied by every API route before the handler runs", async () => {
    let ran = false;
    const route = withErrors("/api/example", async () => {
      ran = true;
      return json({ ok: true });
    });
    const res = await route(request("DELETE", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(ran).toBe(false);
    expect(log.named("request.cross_site")).toEqual([expect.objectContaining({ route: "/api/example", method: "DELETE" })]);
    expect((await route(request("DELETE", { origin: SITE }))).status).toBe(200);
  });

  // The review's scenario: a page on another site posts a form that replaces a visitor's
  // session, or links their device to someone else's kid profile.
  it("a cross-site form post to /api/session and /api/kid gets 403 and sets no cookie", async () => {
    const form = (url: string) =>
      new Request(url, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "text/plain" },
        body: JSON.stringify({ name: "Attacker", action: "join", token: "A".repeat(43) }),
      });
    for (const route of [() => postSessionRoute(form(`${SITE}/api/session`)), () => postKidRoute(form(`${SITE}/api/kid`)), () => deleteKidRoute(request("DELETE", { origin: "https://evil.example" }, `${SITE}/api/kid`))]) {
      const res = await route();
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("the app's own requests still work through the real routes", async () => {
    const start = await postSessionRoute(
      new Request(`${SITE}/api/session`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: JSON.stringify({ name: `Hardening ${Date.now() % 100000}` }) }),
    );
    expect(start.status).toBe(201);
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await getSessionRoute(new Request(`${SITE}/api/session`, { headers: { cookie } }))).status).toBe(200);
  });
});

describe("request bodies and cookies", () => {
  it("reads JSON only when the request says it is JSON", async () => {
    const body = JSON.stringify({ name: "Ana" });
    expect(await readJson(request("POST", { "content-type": "application/json" }, undefined, body))).toEqual({ name: "Ana" });
    expect(await readJson(request("POST", { "content-type": "application/json; charset=utf-8" }, undefined, body))).toEqual({ name: "Ana" });
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp"]) {
      expect(await readJson(request("POST", { "content-type": type }, undefined, body)), type).toBeNull();
    }
    expect(await readJson(new Request(`${SITE}/api/session`, { method: "POST", body }))).toBeNull(); // fetch's default is text/plain
    expect(await readJson(request("POST", { "content-type": "application/json" }, undefined, "not json"))).toBeNull();
    expect(await readJson(request("POST", { "content-type": "application/json" }, undefined, '"a string"'))).toBeNull();
  });

  it("treats a cookie that isn't valid percent-encoding as missing", () => {
    const withCookie = (cookie: string) => request("GET", { cookie });
    expect(readCookie(withCookie("qz_session=%E0%A4%A"), "qz_session")).toBeNull();
    expect(readCookie(withCookie("other=1; qz_session=%"), "qz_session")).toBeNull();
    expect(readCookie(withCookie("qz_session=%E0%A4%A; qz_kid=abc"), "qz_kid")).toBe("abc"); // the others still read
    expect(readCookie(withCookie("qz_session=a%20b"), "qz_session")).toBe("a b");
  });

  it("can set more than one cookie on a response", () => {
    const res = json({}, 200, [
      ["set-cookie", "a=1; Path=/"],
      ["set-cookie", "b=2; Path=/"],
    ]);
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("response headers (vercel.json)", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    crons: Array<{ path: string; schedule: string }>;
  };
  const everywhere = Object.fromEntries(config.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key.toLowerCase(), h.value]));
  const directives = (policy: string) => Object.fromEntries(policy.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

  it("sends the security headers on every route", () => {
    expect(everywhere["x-content-type-options"]).toBe("nosniff");
    expect(everywhere["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(everywhere["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(everywhere["x-frame-options"]).toBe("DENY");
  });

  it("already enforces the directives that can't break sign-in: no framing, no plugins, no <base> tricks", () => {
    expect(directives(everywhere["content-security-policy"])).toEqual({ "frame-ancestors": ["'none'"], "base-uri": ["'self'"], "object-src": ["'none'"] });
  });

  it("reports (without blocking yet) against the full policy", () => {
    const policy = directives(everywhere["content-security-policy-report-only"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
    expect(policy["connect-src"]).toEqual(expect.arrayContaining(["'self'", "https://vercel.com", "https://*.blob.vercel-storage.com"])); // direct uploads to Blob
    expect(policy["report-uri"]).toEqual(["/api/csp-report"]);
    for (const values of Object.values(policy)) for (const v of values) expect(v).not.toBe("*");
  });

  it("schedules the daily cleanup", () => {
    expect(config.crons).toEqual([{ path: "/api/cron", schedule: expect.stringMatching(/^\d+ \d+ \* \* \*$/) }]);
  });
});

describe("CSP violation reports", () => {
  const post = (body: unknown, type = "application/csp-report") =>
    cspReport(new Request(`${SITE}/api/csp-report`, { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("logs the directive, the blocked origin and the page path, nothing else", async () => {
    const res = await post({
      "csp-report": {
        "document-uri": `${SITE}/?invite=secret-token#join=abc`,
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://cdn.evil.example/payload.js?session=123",
        disposition: "report",
        "script-sample": "alert(document.cookie)",
      },
    });
    expect(res.status).toBe(204);
    expect(log.named("csp.violation")).toEqual([
      expect.objectContaining({ directive: "script-src-elem", blocked: "https://cdn.evil.example", path: "/", disposition: "report" }),
    ]);
    const written = log.lines.join("\n");
    for (const secret of ["secret-token", "session=123", "payload.js", "alert("]) expect(written).not.toContain(secret);
  });

  it("understands the Reporting API format and keyword sources", async () => {
    await post(
      [
        { type: "csp-violation", body: { documentURL: `${SITE}/`, effectiveDirective: "style-src-attr", blockedURL: "inline", disposition: "report" } },
        { type: "deprecation", body: { id: "x" } },
      ],
      "application/reports+json",
    );
    expect(log.named("csp.violation")).toEqual([expect.objectContaining({ directive: "style-src-attr", blocked: "inline", path: "/" })]);
  });

  it("ignores anything that isn't a small, well-formed report", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post({ "csp-report": { "effective-directive": "x".repeat(500) } })).status).toBe(204);
    expect((await post({ "csp-report": { "effective-directive": "script-src\n{\"event\":\"forged\"}" } })).status).toBe(204);
    expect((await post({ "csp-report": { "effective-directive": "script-src" } }, "text/plain")).status).toBe(204);
    expect((await post({ "csp-report": { "effective-directive": "script-src", pad: "x".repeat(20_000) } })).status).toBe(204);
    expect((await post(new Array(50).fill({ "csp-report": { "effective-directive": "img-src" } }))).status).toBe(204);
    expect(log.named("csp.violation")).toHaveLength(5); // only the last request, capped at five
  });

  it("is reachable through its route, including from the page itself", async () => {
    const res = await cspReportRoute(
      new Request(`${SITE}/api/csp-report`, { method: "POST", headers: { origin: SITE, "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "effective-directive": "img-src" } }) }),
    );
    expect(res.status).toBe(204);
  });
});

describe("operator flags (Global Config)", () => {
  it("defaults to the leaderboard on and nothing blocked", async () => {
    expect(parseFlags(undefined)).toEqual(DEFAULT_FLAGS);
    expect(parseFlags("off")).toEqual(DEFAULT_FLAGS);
    expect(await flagReader({})()).toEqual(DEFAULT_FLAGS); // no config store connected
  });

  it("reads the switch and the blocked list, ignoring anything malformed", () => {
    expect(parseFlags({ enabled: false })).toEqual({ enabled: false, blockedNames: [] });
    expect(parseFlags({ enabled: "no" })).toMatchObject({ enabled: true }); // only a real `false` switches it off
    expect(parseFlags({ blockedNames: ["Bad Word", 42, "", null, "o'k-ay"] })).toEqual({ enabled: true, blockedNames: ["badword", "okay"] });
    expect(parseFlags({ blockedNames: "badword" })).toEqual(DEFAULT_FLAGS);
  });

  it("matches blocked entries inside a nickname, ignoring case, spaces and punctuation", () => {
    const flags = parseFlags({ blockedNames: ["badword"] });
    expect(foldName("B.a-d W'ord")).toBe("badword");
    for (const name of ["badword", "BADWORD", "My Bad-Word 7", "b a d w o r d"]) expect(isBlockedName(name, flags), name).toBe(true);
    for (const name of ["Good name", "bad", "word"]) expect(isBlockedName(name, flags), name).toBe(false);
    expect(isBlockedName("anything", DEFAULT_FLAGS)).toBe(false);
  });
});

describe("migration splitter (scripts/sql-split.mjs)", () => {
  it("splits on statement ends only", () => {
    expect(splitSql("select 1; select 2;\n\n")).toEqual(["select 1", "select 2"]);
    expect(splitSql("select ';' as a, \"we;ird\" as b; -- trailing; comment\nselect 'it''s; fine'")).toEqual([
      "select ';' as a, \"we;ird\" as b",
      "select 'it''s; fine'",
    ]);
    expect(splitSql("/* a; b */ select 1")).toEqual(["select 1"]);
  });

  it("keeps a function body in one piece", () => {
    const sql = "create function f() returns trigger language plpgsql as $$\nbegin\n  perform 1; -- inside\n  return new;\nend\n$$;\ncreate trigger t before insert on x for each row execute function f();";
    const statements = splitSql(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("perform 1; -- inside\n  return new;");
    expect(splitSql("do $body$ begin perform 'a;b'; end $body$; select $1::text")).toEqual(["do $body$ begin perform 'a;b'; end $body$", "select $1::text"]);
  });
});
