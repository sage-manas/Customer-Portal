/**
 * Tailwind v3 + autoprefixer, matching client/apps/web/postcss.config.js.
 *
 * The scaffold shipped with Tailwind v4's `@tailwindcss/postcss`; the source
 * project's ~40 design tokens are expressed as a v3 preset
 * (packages/config/tailwind-preset.ts), so staying on v3 keeps every class
 * name in the migrated markup meaning exactly what it meant before.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
