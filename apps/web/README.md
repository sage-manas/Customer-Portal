# web

The customer portal + tenant back-office (Next.js App Router). Route groups match the sitemap in `docs/05-UI-UX-DESIGN.md` §4.1:

- `app/(portal)/` — customer-facing portal (`/` dashboard today; `/catalogue`, `/orders`, … per phase)
- `app/(admin)/admin/` — tenant back-office
- `app/(auth)/` — login, registration wizard
- `app/api/auth/*` — login, logout, account switch

## How a request is guarded

1. **`middleware.ts`** (edge runtime) verifies the access-token cookie, checks that the tenant in the host matches the tenant in the JWT claim, and applies the coarse route permission (`/admin/*` needs `admin:view`). A host/claim mismatch rewrites to 404, never 403 — the portal never confirms another tenant's portal exists. It imports `@cc/service-identity/edge`, which contains no Prisma.
2. **Route handlers and server components** re-check with `requirePermission` / `requireSession` from `@cc/service-identity`. Middleware is a gate so an unauthenticated user gets a redirect instead of a rendered shell; the API is what enforces (docs/05 §4.3).
3. **Every DB query** runs inside `runWithTenant` in the service layer, so even a bug in the two layers above cannot read another tenant's rows.

Route handlers stay thin: parse → call a service → map the typed error to a status (docs/DECISIONS.md ADR-002). No auth or SAP logic lives in this app.

## Layers this app may use

`@cc/ui`, `@cc/service-*`, `@cc/domain`, `@cc/config` — never `@cc/adapter-*` or `@cc/db` directly (CLAUDE.md rule 1). SAP data comes through `@cc/service-sap`. Workspace packages ship raw TypeScript, so they're listed in `next.config.mjs`'s `transpilePackages`.

## Environment

Copy `.env.example` to `.env.local`. `lib/env.ts` validates it with Zod on first access — lazily, because `next build` imports every route module and a build machine has no runtime secrets; anything that actually reads a value does so while serving a request, where the variables must exist.

## How to run

```
docker compose -f ../../docker-compose.dev.yml up -d postgres
pnpm --filter @cc/db db:push
pnpm --filter @cc/service-identity db:seed
pnpm --filter web dev
```

Then open `http://acme.localhost:3000/login` — the subdomain is what resolves the tenant — and sign in as `buyer@acme.example` / `portal-dev-password`. Other seeded logins: `viewer@acme.example` (view-only, no write CTAs), `multi@acme.example` (two sold-to accounts, exercises the account switcher), `admin@acme.example` (back-office), `buyer@globex.example` (second tenant).

`http://localhost:3000` also works via `DEFAULT_TENANT_SLUG`.

## How to test

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
```

Playwright smoke tests arrive with the first full module flow (Phase 2), per `docs/06`.
