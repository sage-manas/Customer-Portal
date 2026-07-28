import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the order module: drafts (the only stored part)
 * and the submit path that turns one into a SAP sales order, including the
 * cross-tenant and cross-customer 404 cases.
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
