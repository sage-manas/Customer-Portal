import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true, include: ["**/*.test.ts?(x)"], exclude: ["e2e/**", "node_modules/**"] },
  resolve: {
    alias: {
      "@cc/config/constants": new URL("./packages/config/constants.ts", import.meta.url).pathname,
      "@cc/domain": new URL("./packages/domain/index.ts", import.meta.url).pathname,
      "@cc/ui": new URL("./packages/ui/index.ts", import.meta.url).pathname,
      "@cc/sap-mock": new URL("./packages/sap-mock/index.ts", import.meta.url).pathname,
      "@cc/service-catalogue": new URL("./packages/services/catalogue.ts", import.meta.url).pathname,
      "@": new URL("./", import.meta.url).pathname,
    },
  },
});
