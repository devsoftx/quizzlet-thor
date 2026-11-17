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
    expect((await device.post("/api/score", { data: { answers: [true, true, true, true, true, true], leaderboard: false } })).status()).toBe(200);

    const board = await (await request.get("/api/leaderboard")).json();
    expect(board.top.map((e: { name: string }) => e.name)).not.toContain(hidden.nickname);
    await device.dispose();
  });

  test("an invitation token that doesn't exist is refused", async ({ request }) => {
    const res = await request.post("/api/kid", { data: { action: "peek", token: "A".repeat(43) } });
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "This link has expired or was already used. Ask your parent for a new one." });
  });
});
