import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for outbox exceptions: needs real `OutboxEvent` rows
 * (`docker compose -f docker-compose.dev.yml up -d`, then
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
