import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The relay's Postgres-backed suite runs via `test:integration`; the
    // plain `test` script covers the parts that need neither a database nor
    // a Redis — the handler registry and the relay's own batching logic
    // against a fake publisher.
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/__tests__/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/bin/**", "src/__tests__/**"],
    },
  },
});
