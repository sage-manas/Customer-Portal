import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the cart, which is the only stored thing in
 * this module. Separate config for the
 * same reason `@cc/db` has one: a shared `exclude` can't express both
 * "everything except src/__tests__" and "only src/__tests__".
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
