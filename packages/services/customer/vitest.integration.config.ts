import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the tenant's customer directory (doc 09 §3.4):
 * the list composed from portal rows, an edit that reaches the SAP mock, and
 * a deactivation that a login then refuses.
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
