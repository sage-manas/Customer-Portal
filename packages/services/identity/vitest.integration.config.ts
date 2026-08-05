import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for identity. Small on purpose: the guard, the JWT
 * and the tenant-host resolution are all pure and covered without a
 * database, so what is left needing one is the handful of decisions `login`
 * makes against real rows — chiefly that a tenant deactivated from the
 * operator console (ADR-054) is refused here, which is the only thing that
 * makes that button mean anything.
 *
 * Needs a database (`docker compose -f docker-compose.dev.yml up -d`, then
 * `pnpm --filter @cc/db db:push`).
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
