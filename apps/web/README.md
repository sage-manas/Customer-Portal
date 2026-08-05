# web

The customer portal + tenant back-office (Next.js App Router). Route groups match the sitemap in `docs/05-UI-UX-DESIGN.md` §4.1:

- `app/(portal)/` — customer-facing portal (`/` dashboard, `/catalogue` + `/catalogue/[matnr]` + `/catalogue/price-list` today; `/orders`, … per phase)
- `app/(admin)/admin/` — tenant back-office
- `app/(auth)/` — login, the 4-step registration wizard, `/register/status`
- `app/api/auth/*` — login, logout, account switch
- `app/api/onboarding/*` — the applicant's own endpoints (**public**, see below)
- `app/api/admin/onboarding/*` — reviewer decisions and document downloads
- `app/api/admin/customers/*` — the tenant's customer directory: list, detail, edit (XD02), and the deactivate/reactivate switch. `registrations/*` under it is the back-office half of the onboarding wizard (ADR-056), guarded by `customer:register` rather than a draft token
- `components/onboarding/OnboardingWizard.tsx` — one wizard, two planes: `/register` injects the draft-token client, `/admin/customers/new` the session one
- `app/api/catalogue/*` — the per-card price/stock read (one material per request, per ADR-013)
- `app/api/cart/*` — the cart. `catalogue:view` reads it, `cart:manage` changes it; the KUNNR comes from the session, so there is no cart id to tamper with

## How a request is guarded

1. **`middleware.ts`** (edge runtime) verifies the access-token cookie, checks that the tenant in the host matches the tenant in the JWT claim, and applies the coarse route permission (`/admin/*` needs `admin:view`). A host/claim mismatch rewrites to 404, never 403 — the portal never confirms another tenant's portal exists. It imports `@cc/service-identity/edge`, which contains no Prisma.
2. **Route handlers and server components** re-check with `requirePermission` / `requireSession` from `@cc/service-identity`. Middleware is a gate so an unauthenticated user gets a redirect instead of a rendered shell; the API is what enforces (docs/05 §4.3).
3. **Every DB query** runs inside `runWithTenant` in the service layer, so even a bug in the two layers above cannot read another tenant's rows.

`/api/admin/customers/registrations/*` is the mirror image of that exception: same wizard, same registry-derived validation, but a session holding `customer:register` instead of a token — and it 404s any application the back office did not itself start, so a client admin cannot edit an applicant's in-flight draft (ADR-056).

`/api/onboarding/*` is the deliberate exception to step 1: an applicant has no portal user until their account is approved. Those routes are still tenant-scoped by host, and the application is addressed by an unguessable draft token sent as `x-draft-token` — a wrong or missing one is a 404 (docs/DECISIONS.md ADR-009). `/api/admin/onboarding/*` is **not** public and re-checks `onboarding:review` / `onboarding:approve` per handler; the coarse `admin:view` middleware check is not enough, because a support role can see the shell without being allowed to create a customer in SAP.

Every handler's permission is also declared as data in `API_ROUTES` (`packages/domain/src/api-routes.ts`), and `pnpm --filter web test` runs the sweep that compares that registry against `app/api/**` in both directions — an undeclared handler, a handler guarding a different permission than it declares, and a stale registry row all fail CI (ADR-050). The route×role matrix itself lives with the guard it executes, in `packages/services/identity/src/authz-matrix.test.ts`.

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

Then open `http://acme.localhost:3000/login` — the subdomain is what resolves the tenant — and sign in as `buyer@acme.example` / `portal-dev-password`. Other seeded logins, one per role of the five-tier model (docs/09): `multi@acme.example` (a second `customer`, two sold-to accounts, exercises the account switcher), `admin@acme.example` (`client_admin`), `ap@acme.example` (`ap_manager`), `ar@acme.example` (`ar_manager`), `buyer@globex.example` (second tenant).

`http://localhost:3000` also works via `DEFAULT_TENANT_SLUG`.

## How to test

```
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web build
pnpm --filter web test        # authz sweep: every handler vs the API_ROUTES registry
pnpm --filter web test:e2e     # Playwright, needs the build + a seeded database
```

`e2e/` holds the module happy paths required by `docs/06` ("Playwright smoke E2E per module happy path, against mock adapters"). Phase 2's suite registers a company through all four wizard steps — including a live GSTN verify, two uploads and submission — then signs in to the back office and approves it, which creates the customer in the mock SAP landscape. A second test proves a GSTIN whose state disagrees with the billing address is blocked with an explanation. Phase 3's suite browses the catalogue at customer-specific prices, filters by material group, adds to the cart and edits the drawer, checks MOQ stepping on the product page, reads the price list, and proves a session without `cart:manage` gets no Add to Cart CTA **and** a 403 if it calls the API anyway.

Two suites are about the role model rather than a module. `e2e/roles.spec.ts` is doc 09 §5 read off the screen: for each of the four tenant-plane roles it asserts the sidebar contains exactly the permitted tabs and that a representative forbidden route answers 403 (same tenant) or 404 (another tenant's customer). The expected tab lists are written out rather than computed from `visibleNavItems` — an expectation generated from the registry the app renders from would agree with a registry that is wrong, and the registry-against-itself checks already live in `@cc/domain`'s unit tests. `e2e/register-customer.spec.ts` walks the third criterion end to end: a client admin fills the same wizard `/register` renders, SAP creates the master, the credentials come back once, and the new customer signs in with them and places an order (which SAP holds — a fresh master has no credit limit until FD32 gives it one).

The suite signs in far more often per minute than a person would, from one IP, which is what `middleware.ts`'s public rate limit exists to refuse. Rather than exempt the test anywhere in the app, both limits read `RATE_LIMIT_PUBLIC` / `RATE_LIMIT_TENANT` with the production values (60/min per IP, 600/min per tenant) as defaults, and `playwright.config.ts` raises them for its own server process only.

Playwright starts the app itself on port 3100 (`E2E_PORT` to change) at `acme.localhost`, so tenant resolution is exercised through the subdomain rather than the dev fallback. First run locally: `pnpm --filter web exec playwright install chromium`.
