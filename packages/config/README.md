# @cc/config

Shared tooling configuration. No product/business logic — pure config so every package and app configures itself identically.

## Public API

- `@cc/config/eslint/base` — shared ESLint flat config, including the `eslint-plugin-boundaries` rules that enforce the monorepo dependency rule (`docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`).
- `@cc/config/typescript/base.json` — strict TS base, extended by `nextjs.json` (apps) and `react-library.json` (`packages/ui`).
- `@cc/config/tailwind/preset` — Tailwind theme mapped to the CSS custom property _names_ defined by `packages/ui` tokens. This package only knows the variable names, not their values — see `docs/DECISIONS.md`.
- `@cc/config/constants` — cross-cutting constants (locale, currency, fiscal year). Business/domain constants belong in `packages/domain`, not here.

## How to test

No runtime logic to test. `pnpm typecheck` validates the tsconfig presets compile; consuming packages' own lint/build runs validate the ESLint and Tailwind configs.
