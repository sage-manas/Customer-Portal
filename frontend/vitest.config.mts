import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.ts?(x)"],
    exclude: ["e2e/**", "node_modules/**"],
    /**
     * Hermetic placeholders, never real credentials.
     *
     * `server/env.ts` parses the environment at import time and throws on a
     * missing variable, so any module that transitively reaches it needs these
     * present. They are deliberately obvious fakes: a unit test that actually
     * opened this connection would be an integration test in disguise, and
     * should fail loudly rather than quietly reach a real database.
     */
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
      DIRECT_URL: "postgresql://test:test@127.0.0.1:5432/test",
      AUTH_SECRET: "test-auth-secret-that-is-long-enough-32",
      OPS_AUTH_SECRET: "test-ops-secret-that-is-long-enough-32!",
      CREDENTIAL_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      SAP_DRIVER: "mock",
    },
  },
  resolve: {
    alias: {
      "@cc/config/constants": new URL("./packages/config/constants.ts", import.meta.url).pathname,
      "@cc/domain": new URL("./packages/domain/index.ts", import.meta.url).pathname,
      "@cc/ui": new URL("./packages/ui/index.ts", import.meta.url).pathname,
      "@cc/sap-mock": new URL("./packages/sap-mock/index.ts", import.meta.url).pathname,
      "@cc/service-catalogue": new URL("./packages/services/catalogue.ts", import.meta.url).pathname,
      "@": new URL("./", import.meta.url).pathname,
      // See test/server-only-stub.ts: the real package throws when resolved
      // under the browser condition vitest's jsdom environment sets.
      "server-only": new URL("./test/server-only-stub.ts", import.meta.url).pathname,
    },
  },
});
