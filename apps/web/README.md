# web

The customer portal + tenant back-office (Next.js App Router). Route groups match the sitemap in `docs/05-UI-UX-DESIGN.md` §4.1:

- `app/(portal)/` — customer-facing portal (`/`, `/catalogue`, `/orders`, ...)
- `app/(admin)/admin/` — tenant back-office
- `app/(auth)/` — login, registration wizard

## Phase 0 status

This is a scaffold: it proves the monorepo wiring (Next.js → `@cc/ui` → `@cc/domain`, Tailwind tokens, fonts) works, not the real product screens. Pages are placeholders labeled with the phase that builds them out — see `docs/04-ROADMAP-ZERO-TO-PRODUCTION.md`. Auth, the app shell (top bar/sidebar), and the real dashboard land in Phase 1; feature modules follow per the roadmap's build order.

Workspace packages (`@cc/ui`, `@cc/domain`, `@cc/config`) ship raw TypeScript source, so they're listed in `next.config.mjs`'s `transpilePackages` — Next.js won't compile them otherwise.

## How to run

```
pnpm --filter web dev
```

## How to test

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
```
