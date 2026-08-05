import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke tests (docs/06 engineering standards: "Playwright smoke E2E per
 * module happy path (against mock adapters)").
 *
 * Runs against a real `next start` on a seeded database with every external
 * system on its mock driver — that is the whole point of mock-first: the
 * happy path is exercisable end to end with no SAP or GSTN in sight.
 *
 * The base URL uses `acme.localhost` because the tenant is resolved from the
 * subdomain: hitting bare `localhost` would exercise the dev fallback rather
 * than real tenant resolution.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://acme.localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // A full registration walks four steps, a GSTN call, two uploads and an
  // approval — generous by unit-test standards, ordinary for one user journey.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    // The whole suite signs in from one IP far faster than any person would,
    // and the middleware's public limit (60/min/IP) is right to refuse that
    // in production. Raised here rather than exempted anywhere in the app.
    env: { RATE_LIMIT_PUBLIC: "10000", RATE_LIMIT_TENANT: "100000" },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
