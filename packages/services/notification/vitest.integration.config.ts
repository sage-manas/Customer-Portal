import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the notification module: fan-out from a real
 * event to real inbox rows, recipient resolution across accounts and roles,
 * the redelivery no-op, and the inbox reads.
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
