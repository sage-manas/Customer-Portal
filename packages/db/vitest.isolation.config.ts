import { defineConfig } from "vitest/config";

/**
 * Separate config (not just an --exclude/include CLI flag) for the
 * Postgres-backed isolation suite. Vitest's `exclude` list applies even
 * when a directory is passed as a positional filter, so a single shared
 * config can't cleanly express "everything except src/__tests__" for one
 * script and "only src/__tests__" for another — hence two config files.
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
