// The security headers and nickname rules, checked in a real browser against
// the running app. (e2e/api.e2e.ts covers the API's own refusals.)
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, newDevice, startGuest, test, unique } from "./support";

const origin = () => String(test.info().project.use.baseURL);

test.describe("response headers", () => {
  test("the app, its files and the API send the security headers", async ({ request }) => {
    for (const path of ["/", "/api/session", "/api/leaderboard", "/images/field-fern-moth.png"]) {
      const headers = (await request.get(path)).headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["content-security-policy-report-only"], path).toContain("default-src 'self'");
      expect(headers["permissions-policy"], path).toContain("camera=()");
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
    // The shared fixture fails every test on a reported violation; this one says so by name.
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

  test("the policy reports what it doesn't allow, to the browser and to the server", async ({ browser }) => {
    // Proves the check above can fail: a script from somewhere the policy doesn't list.
    // (Its own page, because the shared fixture fails a test on exactly this.)
    const { page, context, errors } = await newDevice(browser);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ready to explore?" })).toBeVisible();
    expect(errors).toEqual([]);
    const report = page.waitForRequest((request) => request.url().endsWith("/api/csp-report") && request.method() === "POST");
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.src = "https://cdn.not-allowed.example/x.js";
      document.head.append(script);
    });
    await expect.poll(() => errors.some((text) => text.includes("cdn.not-allowed.example"))).toBe(true);
    expect((await report).postData()).toContain("cdn.not-allowed.example");
    await context.close();
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
});

test.describe("nicknames", () => {
  test("a nickname with a blocked word or look-alike letters is refused, kindly", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your nickname").fill("sh1thead");
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Please choose a different nickname.");

    await page.getByLabel("Your nickname").fill("Аna"); // a Cyrillic А
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("alert")).toHaveText("Please use letters from one alphabet in your nickname.");

    await page.getByLabel("Your nickname").fill(unique("Fine"));
    await page.getByRole("button", { name: /Start exploring/ }).click();
    await expect(page.getByRole("heading", { name: "Explore decks" })).toBeVisible();
  });
});
