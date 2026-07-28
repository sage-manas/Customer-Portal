import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the payments module: the initiate → webhook →
 * SAP posting flow, webhook replay, and the cross-tenant/cross-customer 404
 * cases. Payments are the one O2C document the portal stores (ADR-019), so
 * unlike the invoice module this one genuinely needs a database.
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
