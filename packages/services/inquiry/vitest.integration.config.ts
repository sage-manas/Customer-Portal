import { defineConfig } from "vitest/config";

/**
 * Postgres-backed flow suite for Module 3: draft -> inquiry -> quotation ->
 * accept -> order, plus the cross-customer 404s and the expiry gate.
 *
 * Only the *draft* half of this module touches the database (ADR-016 — SAP
 * owns both documents), so most of the module is covered by the plain `test`
 * script against the mock adapter. What needs a database is the part that
 * proves a draft survives, becomes an inquiry, and cannot be reached from
 * another account.
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
