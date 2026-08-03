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
 *   observability is a leaf like config, importable by services, adapters,
 *   db, workers and apps, but not domain or ui (docs/DECISIONS.md ADR-043)
 */
export const boundariesElements = [
  { type: "domain", pattern: "packages/domain/**" },
  { type: "ui", pattern: "packages/ui/**" },
  { type: "observability", pattern: "packages/observability/**" },
  /**
   * `packages/services/*` with a capture, not `packages/services/**` — and
   * the same for adapters. The difference is not cosmetic: with `**`, every
   * service package resolved to the *same* element, so an import from one
   * service to another was an intra-element import, which `element-types`
   * does not check. ADR-011's central rule ("a service may not import
   * another service") was therefore never enforced, silently, in exactly the
   * way ADR-024 describes — found by running the negative control it
   * mandates while building A2. Capturing the module makes each package its
   * own element, so `services -> services` is a cross-element import and the
   * `from: "services"` rule below (which does not allow `services`) applies.
   */
  { type: "services", pattern: "packages/services/*", capture: ["module"] },
  { type: "adapters", pattern: "packages/adapters/*", capture: ["module"] },
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
  { from: "services", allow: ["domain", "adapters", "db", "config", "observability"] },
  { from: "adapters", allow: ["domain", "config", "observability"] },
  { from: "db", allow: ["domain", "config", "observability"] },
  { from: "config", allow: [] },
  { from: "apps", allow: ["ui", "services", "domain", "config", "observability"] },
  // The background layer (ADR-022). It is the only element allowed to touch
  // two services in one file — that is what a relay handler is for — and,
  // like `apps`, nothing may import *from* it, so queue work can never creep
  // back onto the request path.
  {
    from: "workers",
    allow: ["services", "adapters", "db", "domain", "config", "observability"],
  },
  // `observability` has zero *workspace* dependencies, like `config` — it
  // wraps real npm libraries (pino, OpenTelemetry, Sentry) but never reaches
  // into another first-party package (ADR-043). `domain` and `ui` are
  // deliberately left off its allow-list on the *importer* side above: they
  // stay pure/presentational and never call a logger or open a span.
  { from: "observability", allow: [] },
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
      /**
       * Without this, the boundary rules below are decorative.
       *
       * pnpm links workspace packages as symlinks, so `@cc/db` resolves to
       * `packages/services/payment/node_modules/@cc/db/src/index.ts` — a path
       * that matches none of the element patterns. eslint-plugin-boundaries
       * stays silent on imports it cannot classify, so *every* cross-package
       * import in the repo was going unchecked. `preserveSymlinks: false`
       * resolves through the link to `packages/db/src/index.ts`, which the
       * `db` pattern matches. The extensions list is needed for the same
       * reason: every package's entry point is a `.ts` file, which the
       * resolver does not consider by default.
       */
      "import/resolver": {
        node: {
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
          preserveSymlinks: false,
        },
      },
      /**
       * `boundaries/root-path`, not `boundaries/root` — the latter is not a
       * setting the plugin reads, so it was silently ignored and the plugin
       * fell back to `process.cwd()`. Each package runs `eslint .` from its
       * own directory, which made every file's path relative to *that*
       * package, so `packages/services/**` matched nothing and every file
       * was "not of any known element type". An unclassified file is one the
       * rule says nothing about, which is why the boundaries were passing.
       */
      "boundaries/root-path": repoRoot,
      "boundaries/elements": boundariesElements,
      "boundaries/ignore": [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        // Tooling config, not application code — it takes part in no layer.
        // (It also can't be classified: a glob's `**` does not cross a
        // dot-directory, so `packages/ui/**` never matched `.storybook/`.)
        "**/.storybook/**",
      ],
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
      /**
       * The guard on the guard. `element-types` says nothing about a file it
       * cannot classify, so a misconfiguration doesn't fail — it goes quiet,
       * which is exactly how the `boundaries/root` typo above survived. This
       * rule makes an unclassifiable file an error in its own right, so the
       * next time the settings drift, CI says so instead of shrugging.
       */
      "boundaries/no-unknown-files": "error",
      /**
       * CLAUDE.md rule 5 / doc 09 §5, made mechanical: branching on a role is
       * an error outside `@cc/domain` (which overrides this rule in its own
       * config, because the registry is where roles are allowed to be named).
       *
       * Both halves are required to match — something *named* like a role on
       * one side, a role *identifier* on the other. Matching the literal
       * alone was tried first and fired on `visibility === "customer"` in
       * `@cc/service-support`, which compares a query plane that happens to
       * share a word with a role; a rule that has to be suppressed at honest
       * callsites stops being read. Matching the name alone would be worse
       * still, silencing nothing and flagging `role === expected` in tests.
       * The four selectors are the shapes a role check actually takes:
       * `===`/`!==`, `switch (role)`, `roles.includes("…")` and
       * `["…"].includes(role)`.
       */
      "no-restricted-syntax": [
        "error",
        ...(() => {
          const ROLE_IDS =
            "super_admin|sap_manager|client_admin|ap_manager|ar_manager|customer|platform_operator|tenant_admin|tenant_sales|tenant_credit|tenant_support|buyer_admin|buyer_user|buyer_view_only";
          const literal = `Literal[value=/^(${ROLE_IDS})$/]`;
          const named = "/^([Rr]ole|[Rr]oles|.*[Rr]oles?)$/";
          const message =
            "Never branch on a role. Ask hasPermission(session, '...') instead (CLAUDE.md rule 5); roles map to permissions only in @cc/domain/auth.ts.";
          return [
            // role === "client_admin" / session.roles[0] !== "customer"
            {
              selector: `BinaryExpression[operator=/^([=!]==?)$/][left.name=${named}] > ${literal}`,
              message,
            },
            {
              selector: `BinaryExpression[operator=/^([=!]==?)$/][left.property.name=${named}] > ${literal}`,
              message,
            },
            // switch (role) { case "ap_manager": }
            {
              selector: `SwitchStatement[discriminant.name=${named}] > SwitchCase > ${literal}`,
              message,
            },
            // session.roles.includes("client_admin")
            {
              selector: `CallExpression[callee.property.name="includes"][callee.object.property.name=${named}] > ${literal}`,
              message,
            },
            {
              selector: `CallExpression[callee.property.name="includes"][callee.object.name=${named}] > ${literal}`,
              message,
            },
          ];
        })(),
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
