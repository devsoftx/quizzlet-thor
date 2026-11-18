// The API's contract, checked directly: who may call what, and how mistakes are answered.
// (The browser tests cover the same flows through the app.)
import { asParent, expect, test, unique } from "./support";

test.describe("API", () => {
  test("no session is a normal answer: 200 with null, and no cookie to clear", async ({ request }) => {
    const res = await request.get("/api/session");
    expect(res.status()).toBe(200);
    expect(await res.json()).toBeNull();
    expect(res.headers()["set-cookie"]).toBeUndefined();
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("a private-deck check without a session is refused", async ({ request }) => {
    const res = await request.get("/api/session?deckId=anything");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "No active session." });
  });

  test("signed-in routes refuse callers who aren't signed in", async ({ request }) => {
    for (const route of ["/api/me", "/api/profiles", "/api/decks", "/api/files", "/api/invites"]) {
      expect((await request.get(route)).status(), route).toBe(401);
    }
  });

  test("the public routes answer without sign-in", async ({ request }) => {
    expect((await request.get("/api/leaderboard")).status()).toBe(200);
    expect(await (await request.get("/api/kid")).json()).toEqual({ kid: null });
  });

  test("unknown routes are not found", async ({ request }) => {
    expect((await request.get("/api/no-such-route")).status()).toBe(404);
  });

  test("starting a session checks the nickname", async ({ request }) => {
    for (const name of ["", "   ", "!!!", "x".repeat(25), 42]) {
      const res = await request.post("/api/session", { data: { name } });
      expect(res.status(), JSON.stringify(name)).toBe(400);
    }
  });

  test("points need a session", async ({ request }) => {
    const res = await request.post("/api/score", { data: { answers: [true] } });
    expect(res.status()).toBe(401);
  });

  test("scores are checked and a retried batch is counted once", async ({ request }) => {
    const start = await request.post("/api/session", { data: { name: unique("Api") } });
    expect(start.status()).toBe(201);
    const { sessionTag } = await start.json();
    const score = (data: object) => request.post("/api/score", { data: { leaderboard: false, sessionTag, ...data } });

    expect((await score({ answers: ["yes"] })).status()).toBe(400);
    expect((await score({ answers: [true], streakBefore: -1 })).status()).toBe(400);
    expect((await score({ answers: [true], batchId: "bad id!" })).status()).toBe(400);

    const first = await score({ answers: [true], batchId: "batch-1" });
    expect(first.status()).toBe(200);
    const again = await score({ answers: [true], batchId: "batch-1" });
    expect(await again.json()).toEqual(await first.json());
    expect((await score({ answers: [false], batchId: "batch-1" })).status()).toBe(409); // same id, different answers
    expect((await score({ answers: [true], sessionTag: "not-this-session" })).status()).toBe(409);

    expect(await (await request.get("/api/session")).json()).toMatchObject({ points: 10 });
  });

  test("a kid hidden from the leaderboard never appears on it", async ({ playwright, request }) => {
    const parent = asParent(request, unique("parent-"));
    const hidden = await parent.createProfile(unique("Hidden"), false);
    // A separate cookie jar for the kid's session.
    const device = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const start = await device.post("/api/session", { headers: parent.headers, data: { profileId: hidden.id } });
    expect(start.status()).toBe(201);
    const { sessionTag } = await start.json();
    const saved = await device.post("/api/score", { data: { answers: [true, true, true, true, true, true], leaderboard: false, sessionTag, batchId: "hidden-1" } });
    expect(saved.status()).toBe(200);

    const board = await (await request.get("/api/leaderboard")).json();
    expect(board.top.map((e: { name: string }) => e.name)).not.toContain(hidden.nickname);
    await device.dispose();
  });

  test("a save needs the session's tag and a batch id (an out-of-date page can't save)", async ({ request }) => {
    const start = await request.post("/api/session", { data: { name: unique("Old") } });
    const { sessionTag } = await start.json();
    expect((await request.post("/api/score", { data: { answers: [true], batchId: "b1" } })).status()).toBe(400);
    expect((await request.post("/api/score", { data: { answers: [true], sessionTag } })).status()).toBe(400);
    expect(await (await request.get("/api/session")).json()).toMatchObject({ points: 0 });
  });

  test("the server keeps the streak: a claimed one earns no bonus, and a flood of answers is refused", async ({ request }) => {
    const start = await request.post("/api/session", { data: { name: unique("Forge") } });
    const { sessionTag } = await start.json();
    const score = (data: object) => request.post("/api/score", { data: { leaderboard: false, sessionTag, ...data } });

    const forged = await score({ answers: [true], streakBefore: 200, batchId: "forged" });
    expect(await forged.json()).toMatchObject({ pointsEarned: 10, sessionPoints: 10 }); // no streak bonus

    // The review's run: 200 "correct" answers at once. More than a new session's burst of 20: refused, nothing saved.
    const flood = await score({ answers: new Array(200).fill(true), streakBefore: 200, batchId: "flood" });
    expect(flood.status()).toBe(429);
    expect(await (await request.get("/api/session")).json()).toMatchObject({ points: 10 });
  });

  test("a guest nickname belongs to the browser that first used it", async ({ playwright, request }) => {
    const name = unique("Mine");
    expect((await request.post("/api/session", { data: { name } })).status()).toBe(201);
    expect((await request.post("/api/session", { data: { name: name.toUpperCase() } })).status()).toBe(201); // the same browser, any case

    const other = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const taken = await other.post("/api/session", { data: { name } });
    expect(taken.status()).toBe(409);
    expect(await taken.json()).toEqual({ error: "That nickname is taken. Please pick another one." });
    await other.dispose();
  });

  test("a write from another site is refused, and a form can't stand in for JSON", async ({ request }) => {
    const origin = test.info().project.use.baseURL!;
    const body = JSON.stringify({ name: unique("Csrf"), action: "join", token: "A".repeat(43) });
    for (const route of ["/api/session", "/api/kid"]) {
      // What a form on another site would send: its own Origin, and a "simple" content type.
      const crossSite = await request.post(route, { headers: { origin: "https://evil.example", "content-type": "text/plain" }, data: body });
      expect(crossSite.status(), route).toBe(403);
      expect(crossSite.headers()["set-cookie"], route).toBeUndefined();
      // Even with JSON, another site's Origin is refused.
      expect((await request.post(route, { headers: { origin: "https://evil.example" }, data: JSON.parse(body) })).status(), route).toBe(403);
    }
    expect((await request.delete("/api/kid", { headers: { origin: "https://evil.example" } })).status()).toBe(403);
    // From this site, a body that isn't JSON is simply not read.
    const plain = await request.post("/api/session", { headers: { origin, "content-type": "text/plain" }, data: body });
    expect(plain.status()).toBe(400);
    // And the app's own requests (same Origin, JSON) work.
    expect((await request.post("/api/session", { headers: { origin }, data: JSON.parse(body) })).status()).toBe(201);
  });

  test("a damaged cookie gets the normal answers, not a server error", async ({ request }) => {
    const headers = { cookie: "qz_session=%E0%A4%A; qz_kid=%" };
    const session = await request.get("/api/session", { headers });
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();
    expect(await (await request.get("/api/kid", { headers })).json()).toEqual({ kid: null });
    expect((await request.get("/api/leaderboard", { headers })).status()).toBe(200);
    expect((await request.post("/api/score", { headers, data: { answers: [true] } })).status()).toBe(401);
  });

  test("the cleanup route is closed without its secret, and CSP reports are accepted", async ({ request }) => {
    expect([401, 503]).toContain((await request.get("/api/cron")).status());
    const report = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://example.com/x.png" } }),
    });
    expect(report.status()).toBe(204);
  });

  test("an invitation token that doesn't exist is refused", async ({ request }) => {
    const res = await request.post("/api/kid", { data: { action: "peek", token: "A".repeat(43) } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "This link has expired or was already used. Ask your parent for a new one." });
  });
});
