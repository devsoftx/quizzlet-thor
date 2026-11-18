// The hardening from the red-team review, checked on the wire: response
// headers, requests from other sites, odd bodies and cookies, rate limits.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, newDevice, startGuest, test, unique } from "./support";

const origin = () => String(test.info().project.use.baseURL);

/** An address from the block reserved for examples, different every time. */
const someAddress = () => `2001:db8::${[1, 2, 3].map(() => Math.floor(Math.random() * 0xffff).toString(16)).join(":")}`;

test.describe("response headers", () => {
  test("the app and the API send the security headers", async ({ request }) => {
    for (const path of ["/", "/api/session", "/api/leaderboard", "/images/field-fern-moth.png"]) {
      const headers = (await request.get(path)).headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(headers["content-security-policy-report-only"], path).toContain("default-src 'self'");
    }
  });

  test("the page can't be put in a frame by another site", async ({ browser }) => {
    // Another site: a page on a different origin that puts the app in a frame.
    const otherSite = createServer((_req, res) =>
      res.writeHead(200, { "content-type": "text/html" }).end(`<h1>Win a prize</h1><iframe id="app" src="${origin()}/"></iframe>`),
    );
    await new Promise<void>((resolve) => otherSite.listen(0, "127.0.0.1", resolve));
    // Its own page: the refusal is exactly what the shared fixture would flag.
    const { page, context, errors } = await newDevice(browser);
    try {
      await page.goto(`http://127.0.0.1:${(otherSite.address() as AddressInfo).port}/`);
      await expect(page.getByRole("heading", { name: "Win a prize" })).toBeVisible();
      // The browser refuses to show the app inside the frame at all.
      await expect.poll(() => errors.some((text) => /frame-ancestors 'none'.*request has been blocked/s.test(text))).toBe(true);
      expect(page.frames().some((frame) => frame.url().startsWith(origin()))).toBe(false);
      await expect(page.frameLocator("#app").getByRole("heading", { name: "Ready to explore?" })).toHaveCount(0);
    } finally {
      await context.close();
      otherSite.close();
    }
  });

  test("a whole session breaks none of the content policy's rules", async ({ page }) => {
    // The shared fixture fails this test if the browser reports a violation.
    const seen: string[] = [];
    page.on("console", (message) => seen.push(message.text()));
    await startGuest(page, unique("Policy"));
    await page.getByRole("button", { name: /^Study / }).first().click();
    await page.getByRole("button", { name: /Start practice/ }).click();
    await page.locator(".options").getByRole("button").first().click();
    await expect(page.locator(".field-feedback")).toBeVisible();
    await page.getByRole("button", { name: "← Decks" }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
    expect(seen.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
  });

  test("the policy does report what it doesn't allow", async ({ browser }) => {
    // Proves the check above can fail: a script from somewhere the policy doesn't list.
    // (Its own page, because the shared fixture fails a test on exactly this.)
    const { page, context, errors } = await newDevice(browser);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.src = "https://cdn.not-allowed.example/x.js";
      document.head.append(script);
    });
    await expect.poll(() => errors.some((text) => text.includes("cdn.not-allowed.example"))).toBe(true);
    await context.close();
  });
});

test.describe("requests from other sites and odd input", () => {
  test("a text/plain or form POST is refused before it can start a session or use a link", async ({ request }) => {
    const body = JSON.stringify({ name: unique("Form"), action: "join", token: "A".repeat(43) });
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      for (const path of ["/api/session", "/api/kid"]) {
        const res = await request.post(path, { headers: { "content-type": type }, data: body });
        expect(res.status(), `${type} ${path}`).toBe(415);
        expect(res.headers()["set-cookie"]).toBeUndefined();
      }
    }
    expect(await (await request.get("/api/session")).json()).toBeNull();
  });

  test("a state-changing request from another origin is refused; this site's own pass", async ({ request }) => {
    const name = unique("Origin");
    const crossSite = await request.post("/api/session", { headers: { origin: "https://evil.example" }, data: { name } });
    expect(crossSite.status()).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "This request came from another site." });

    const own = await request.post("/api/session", { headers: { origin: origin() }, data: { name } });
    expect(own.status()).toBe(201);
    // Ending the session from another site doesn't work either.
    expect((await request.delete("/api/session", { headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect(await (await request.get("/api/session")).json()).toMatchObject({ name });
  });

  test("the browser's own requests carry this site's origin and are accepted", async ({ page }) => {
    const posts: Array<Promise<{ origin: string | undefined; status: number }>> = [];
    page.on("response", (res) => {
      if (res.request().method() !== "POST" || !res.url().includes("/api/")) return;
      posts.push(res.request().allHeaders().then((headers) => ({ origin: headers["origin"], status: res.status() })));
    });
    await startGuest(page, unique("Same"));
    expect(await Promise.all(posts)).toEqual([{ origin: origin(), status: 201 }]);
  });

  test("a cookie that isn't valid text gets the normal answers, not a server error", async ({ request }) => {
    const cookie = "qz_session=%E0%A4%A; qz_kid=%";
    const session = await request.get("/api/session", { headers: { cookie } });
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();
    expect(await (await request.get("/api/kid", { headers: { cookie } })).json()).toEqual({ kid: null });
    expect((await request.get("/api/leaderboard", { headers: { cookie } })).status()).toBe(200);
    expect((await request.post("/api/score", { headers: { cookie }, data: { batchId: "b", answers: [true] } })).status()).toBe(401);
  });

  test("a nickname with a blocked word or look-alike letters is refused, kindly", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your nickname").fill("sh1thead");
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("That nickname isn't allowed. Please choose a different one.");

    await page.getByLabel("Your nickname").fill("Аna"); // a Cyrillic А
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Please use letters from one alphabet in your nickname.");

    await page.getByLabel("Your nickname").fill(unique("Fine"));
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  });
});

test.describe("limits", () => {
  test("too many invitation-link tries from one address are answered 429", async ({ request }) => {
    // The address the platform reports in production; the tests have none, so they aren't limited.
    const headers = { "x-real-ip": someAddress() };
    const peek = () => request.post("/api/kid", { headers, data: { action: "peek", token: "A".repeat(43) } });
    // 30 a minute are allowed (RATE_LIMITS.kid in server/route.ts).
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await peek()).status());
    expect(statuses.slice(0, 30).every((status) => status === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
    const limited = await peek();
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: "Too many requests. Please wait a minute and try again." });

    // Another address, and requests with none, still get through.
    expect((await request.post("/api/kid", { headers: { "x-real-ip": someAddress() }, data: { action: "peek", token: "A".repeat(43) } })).status()).toBe(404);
    expect((await request.post("/api/kid", { data: { action: "peek", token: "A".repeat(43) } })).status()).toBe(404);
  });

  test("points claimed faster than anyone can answer are refused, and nothing is added", async ({ request }) => {
    const start = await request.post("/api/session", { data: { name: unique("Fast") } });
    const { sessionTag } = await start.json();
    const save = (batchId: string, count: number) =>
      request.post("/api/score", { data: { batchId, sessionTag, leaderboard: false, streakBefore: 200, answers: new Array(count).fill(true) } });

    // A fresh session can save a first deck's worth at once…
    const first = await save("first", 20);
    expect(first.status()).toBe(200);
    // …scored with the server's own streak, whatever the browser claims: 10+10 then 18 x 15.
    expect(await first.json()).toMatchObject({ pointsEarned: 290, sessionPoints: 290 });

    // …but a script sending round after round is told to wait.
    const flood = await save("flood", 200);
    expect(flood.status()).toBe(429);
    expect(Number(flood.headers()["retry-after"])).toBeGreaterThan(200);
    expect(await (await request.get("/api/session")).json()).toMatchObject({ points: 290 });
  });
});
