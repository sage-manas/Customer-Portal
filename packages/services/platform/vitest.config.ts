import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The Postgres-backed provisioning/health flows run via `test:integration`;
    // the plain `test` script covers password hashing, JWT issue/verify and
    // staleness-free pure logic against no database.
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
