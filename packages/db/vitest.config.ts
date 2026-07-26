import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    // Phase 0 has no pure-unit tests in @cc/db, only the Postgres-backed
    // isolation suite (run separately via `test:isolation`, which targets
    // src/__tests__ directly and so isn't affected by this exclude) — the
    // plain `test` script legitimately matches zero files locally without a
    // DB. Excluding here (JS config) rather than a CLI --exclude flag in
    // package.json avoids a real cross-platform bug: cmd.exe (Windows)
    // doesn't strip single quotes the way POSIX shells do, so a quoted
    // glob passed on the command line silently reaches vitest unquoted.
    exclude: [...configDefaults.exclude, "src/__tests__/**"],
    passWithNoTests: true,
  },
});
