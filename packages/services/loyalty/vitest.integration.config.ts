import { defineConfig } from "vitest/config";

/**
 * Postgres-backed flow suite for Module 9: request a credit increase, see it
 * in the desk's queue, decide it, and fail to reach another account's.
 *
 * Only the credit-request workflow and the tenant's tier thresholds touch the
 * database — the credit position, the tier and DSO are derived from SAP reads
 * on every call and are covered by the plain `test` script against the mock
 * adapter. What needs a database is the part with rows: the workflow's
 * transitions, its outbox events, and the cross-account 404.
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
