import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "src/__tests__/**"],
    // Every function here needs a real database (it composes `OutboxEvent`
    // rows), so unlike @cc/service-payment there is no DB-free half — the
    // whole suite lives under test:integration and this script has nothing
    // to run.
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/__tests__/**"],
    },
  },
});
