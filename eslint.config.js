import base from "@cc/config/eslint/base";

/**
 * Root-level config. ESLint's flat config resolution starts searching from
 * the process's cwd and walks upward — it does NOT descend into
 * subdirectories to find a package's own eslint.config.js. Tools that run
 * from the repo root (lint-staged via Husky's pre-commit hook, `eslint .`
 * run from root) need this file to find *any* config at all. Each
 * package's own eslint.config.js (same base, plus package-specific
 * additions like the Next.js plugin in apps/web) is what actually runs
 * during `pnpm --filter <pkg> lint` / CI, since those invocations have cwd
 * set to that package's directory.
 */
export default [
  ...base,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/storybook-static/**",
      "packages/db/generated/**",
      // Next.js-managed, "should not be edited" — regenerated on every
      // `next build`/`next dev` with a triple-slash reference that's
      // expected, not a violation.
      "**/next-env.d.ts",
      // k6 load-test scripts (docs/07 B6): not a workspace package, run by
      // the k6 binary rather than Node/a bundler, and use k6's own globals
      // (`__ENV`) that no eslint env here declares. Out of scope for the
      // boundaries graph the same way `.storybook/**` already is.
      "loadtest/**",
    ],
  },
];
