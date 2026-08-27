import type { Config } from "tailwindcss";

import preset from "./packages/config/tailwind-preset";

/**
 * Migrated from client/apps/web/tailwind.config.ts. The preset is the
 * source project's, copied verbatim — it maps Tailwind theme keys onto the
 * CSS custom properties in packages/ui/tokens.css.
 */
const config: Config = {
  presets: [preset as Config],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./packages/ui/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
};

export default config;
