import { defineConfig } from "vitest/config";

/**
 * Postgres-backed suite for the outbox relay: write-in-transaction,
 * dedupe, claim-publish-mark, the crash-between-publish-and-mark
 * republication, and the per-tenant scoping of the relay's own reads.
 *
 * Needs a database (`docker compose -f docker-compose.dev.yml up -d`, then
 * `pnpm --filter @cc/db db:push`). It does **not** need Redis: the publisher
 * is an interface and the suite passes a fake, so the relay's semantics are
 * tested without standing up a broker.
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
