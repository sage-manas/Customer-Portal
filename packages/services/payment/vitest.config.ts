import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The Postgres-backed payment-flow suite runs via `test:integration`; the
    // plain `test` script covers the statement half, which stores nothing and
    // must pass without a database.
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/__tests__/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/__tests__/**"],
    },
  },
});
