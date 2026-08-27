import { defineConfig } from "@playwright/test";

/**
 * scripts/qa/*.mjs were a test harness without a runner (helpers.mjs already
 * had loginAs/trackErrors/classify) — this promotes that into a real,
 * CI-runnable suite (REMEDIATION-PLAN §7 Tier 3).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // Each route-sweep test walks dozens of routes on one page -- well past
  // the 30s single-action default.
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx next start -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
