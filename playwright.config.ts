// End-to-end tests: the real app in a real browser, against the local dev
// server (Vite + the /api functions) with in-memory storage and the local
// sign-in stand-in. Run with `npm run test:e2e`.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5181);
const baseURL = `http://localhost:${PORT}`;

/**
 * Every key that would connect the server to a real service, blanked. The test
 * server then always uses the in-memory stores and the local sign-in, even if
 * .env.local or the shell holds real keys, so a test run can never touch
 * production data. (Vite and the server treat an empty value as "not set".)
 */
const NO_REAL_SERVICES = Object.fromEntries(
  [
    "DATABASE_URL",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "BLOB_READ_WRITE_TOKEN",
    "BLOB_STORE_ID",
    "CLERK_SECRET_KEY",
    "CLERK_PUBLISHABLE_KEY",
    "VITE_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "VERCEL",
    "VERCEL_OIDC_TOKEN",
    "ANTHROPIC_API_KEY",
  ].map((key) => [key, ""]),
);

export default defineConfig({
  testDir: "e2e",
  // *.e2e.ts, so Vitest (which picks up *.test.ts and *.spec.ts) leaves these alone.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The core learner journey again on a phone-sized screen.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: baseURL,
    // Always a fresh server with the settings above, never one already running.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...NO_REAL_SERVICES, QUIZZLET_DEV_AUTH: "1" },
  },
});
