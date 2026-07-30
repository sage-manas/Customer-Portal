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
    /**
     * One file at a time, against one database.
     *
     * These two suites are not independent the way unit tests are, and the
     * reason is specific to this package: `relayOnce` sweeps **every tenant**
     * by design, so a file running it claims rows belonging to whatever the
     * *other* file is creating, wiping and deleting at that moment — and a
     * row deleted between the claim and the mark fails the update. It
     * reproduced about one run in six.
     *
     * Serialising is the honest fix rather than teaching the relay to ignore
     * unknown tenants, because sweeping every tenant is exactly what the
     * production process does and what the test is there to assert.
     */
    fileParallelism: false,
  },
});
