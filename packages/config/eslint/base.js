// @ts-check
import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

// packages/config/eslint/base.js -> repo root is three levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Shared ESLint flat config. Encodes the monorepo dependency rule from
 * docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md:
 *   ui -> domain only
 *   services -> domain + adapters + db
 *   apps -> ui + services + domain
 *   adapters -> domain only (never services)
 *   db -> domain only
 *   domain -> nothing internal
 *   workers -> services + adapters + db + domain (docs/DECISIONS.md ADR-022)
 *   nothing imports from apps or workers
 */
export const boundariesElements = [
  { type: "domain", pattern: "packages/domain/**" },
  { type: "ui", pattern: "packages/ui/**" },
  { type: "services", pattern: "packages/services/**" },
  { type: "adapters", pattern: "packages/adapters/**" },
  { type: "db", pattern: "packages/db/**" },
  { type: "config", pattern: "packages/config/**" },
  { type: "workers", pattern: "packages/workers/**" },
  { type: "apps", pattern: "apps/**" },
];

// `config` has zero dependencies of its own, so allowing every layer to
// import it cannot introduce a cycle or leak a layer's internals upward —
// see docs/DECISIONS.md ADR-004.
const boundariesRules = [
  { from: "domain", allow: ["config"] },
  { from: "ui", allow: ["domain", "config"] },
  { from: "services", allow: ["domain", "adapters", "db", "config"] },
  { from: "adapters", allow: ["domain", "config"] },
  { from: "db", allow: ["domain", "config"] },
  { from: "config", allow: [] },
  { from: "apps", allow: ["ui", "services", "domain", "config"] },
  // The background layer (ADR-022). It is the only element allowed to touch
  // two services in one file — that is what a relay handler is for — and,
  // like `apps`, nothing may import *from* it, so queue work can never creep
  // back onto the request path.
  { from: "workers", allow: ["services", "adapters", "db", "domain", "config"] },
];

export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/storybook-static/**",
      "**/coverage/**",
      "**/generated/**",
      "**/*.config.js",
      "**/*.config.ts",
    ],
  },
  {
    plugins: { boundaries, import: importPlugin },
    settings: {
      "boundaries/root": repoRoot,
      "boundaries/elements": boundariesElements,
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    },
    rules: {
      "@typescript-eslint/no-explicit-any": ["error", { ignoreRestArgs: false }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: boundariesRules,
        },
      ],
    },
  },
);

export default baseConfig;
