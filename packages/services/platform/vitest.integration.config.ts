import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the operator console (docs/07 B5): provisioning
 * a tenant end to end (Tenant row + first tenant_admin user), and the
 * per-tenant health/usage reads against real `OutboxEvent`/`SalesOrder`/etc
 * rows.
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
