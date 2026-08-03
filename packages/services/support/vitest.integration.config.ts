import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the support module. Unlike delivery or invoices,
 * essentially *all* of this module is storage — the portal owns the ticket
 * outright — so the flow suite is the module's main test: raise, comment,
 * assign, resolve, reopen, rate, plus the cross-tenant and cross-customer 404
 * cases and the internal-note visibility rule.
 *
 * Needs a database (`docker compose -f docker-compose.dev.yml up -d`, then
 * `pnpm --filter @cc/db db:push`). Runs in CI as its own step.
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
