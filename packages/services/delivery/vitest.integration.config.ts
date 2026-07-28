import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the delivery module: the POD path, which is the
 * only part of this module that stores anything (ADR-026) — the confirmation
 * row, the outbox event written in the same transaction, and the cross-tenant
 * and cross-customer 404 cases.
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
