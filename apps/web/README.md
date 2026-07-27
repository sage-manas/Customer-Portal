# web

The customer portal + tenant back-office (Next.js App Router). Route groups match the sitemap in `docs/05-UI-UX-DESIGN.md` §4.1:

- `app/(portal)/` — customer-facing portal (`/` dashboard today; `/catalogue`, `/orders`, … per phase)
- `app/(admin)/admin/` — tenant back-office
- `app/(auth)/` — login, the 4-step registration wizard, `/register/status`
- `app/api/auth/*` — login, logout, account switch
- `app/api/onboarding/*` — the applicant's own endpoints (**public**, see below)
- `app/api/admin/onboarding/*` — reviewer decisions and document downloads

## How a request is guarded

1. **`middleware.ts`** (edge runtime) verifies the access-token cookie, checks that the tenant in the host matches the tenant in the JWT claim, and applies the coarse route permission (`/admin/*` needs `admin:view`). A host/claim mismatch rewrites to 404, never 403 — the portal never confirms another tenant's portal exists. It imports `@cc/service-identity/edge`, which contains no Prisma.
2. **Route handlers and server components** re-check with `requirePermission` / `requireSession` from `@cc/service-identity`. Middleware is a gate so an unauthenticated user gets a redirect instead of a rendered shell; the API is what enforces (docs/05 §4.3).
3. **Every DB query** runs inside `runWithTenant` in the service layer, so even a bug in the two layers above cannot read another tenant's rows.

`/api/onboarding/*` is the deliberate exception to step 1: an applicant has no portal user until their account is approved. Those routes are still tenant-scoped by host, and the application is addressed by an unguessable draft token sent as `x-draft-token` — a wrong or missing one is a 404 (docs/DECISIONS.md ADR-009). `/api/admin/onboarding/*` is **not** public and re-checks `onboarding:review` / `onboarding:approve` per handler; the coarse `admin:view` middleware check is not enough, because a support role can see the shell without being allowed to create a customer in SAP.

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
pnpm --filter web test:e2e     # Playwright, needs the build + a seeded database
```

`e2e/` holds the module happy paths required by `docs/06` ("Playwright smoke E2E per module happy path, against mock adapters"). Phase 2's suite registers a company through all four wizard steps — including a live GSTN verify, two uploads and submission — then signs in to the back office and approves it, which creates the customer in the mock SAP landscape. A second test proves a GSTIN whose state disagrees with the billing address is blocked with an explanation.

Playwright starts the app itself on port 3100 (`E2E_PORT` to change) at `acme.localhost`, so tenant resolution is exercised through the subdomain rather than the dev fallback. First run locally: `pnpm --filter web exec playwright install chromium`.
