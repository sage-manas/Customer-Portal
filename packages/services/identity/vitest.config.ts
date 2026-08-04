import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `src/__tests__` needs a real Postgres and runs as its own step
    // (`test:integration`), mirroring every other service in the repo.
    exclude: ["src/__tests__/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/edge.ts"],
    },
  },
});
