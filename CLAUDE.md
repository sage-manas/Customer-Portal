# CLAUDE.md

Guidance for Claude Code (or any future session) working in this repo. Read `docs/00-PORTAL-OVERVIEW.md` through `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md` first — this file is the condensed, load-bearing subset for day-to-day work, not a replacement for those docs. `docs/DECISIONS.md` records every decision made where a doc was ambiguous; check it before re-deciding something.

## The rules that must never be silently broken

1. **Dependency boundaries** (enforced by `eslint-plugin-boundaries`, `packages/config/eslint/base.js`):
   `domain -> config only` · `ui -> domain, config` · `services -> domain, adapters, db, config` · `adapters -> domain, config` (never `services`) · `db -> domain, config` · `apps -> ui, services, domain, config` · nothing imports from `apps`. `config` has zero dependencies of its own. Full rationale: `docs/DECISIONS.md` ADR-004.

2. **Mock-first.** Every external system (SAP, GSTN, e-invoice, e-way bill, payment gateway) sits behind an interface with a mock implementation built first. App/service code never imports a driver directly — only the interface, resolved per tenant via a factory.

3. **Registries, not hand-duplication.** SAP field metadata lives in `packages/domain/src/sap-mapping/*.ts` (`SapFieldDef[]`); Zod schemas are _derived_ from it via `buildZodSchema`, never hand-written per screen. Canonical statuses and their SAP-code origins live in `packages/domain/src/status.ts`; UI components render `CanonicalStatus` + `statusBadgeVariant`, never a raw SAP code. If you're about to write a `z.object({...})` or a `switch` on a SAP status code by hand, check whether a registry should grow instead.

4. **Tenant isolation is structural, not conventional.** Every tenant-owned Prisma model carries `tenantId` and is listed in `TENANT_SCOPED_MODELS` (`packages/db/src/tenant-middleware.ts`). All DB access must be wrapped in `runWithTenant(tenantId, fn)` (`packages/db/src/tenant-context.ts`) — a query with no bound tenant context throws before reaching Postgres. See `docs/DECISIONS.md` ADR-003 for why this is row-level `tenantId`, not schema-per-tenant, in Phase 0.

5. **Permissions are a registry too, and the API is what enforces them.** Roles map to permissions in `packages/domain/src/auth.ts`; routes and nav items declare the permission they need (`packages/domain/src/navigation.ts`). Never write `if (role === "tenant_admin")` — ask `hasPermission(session, "...")`. Hiding a nav item is presentation; `requirePermission` in the route handler is the control (docs/05 §4.3). Cross-tenant and cross-customer access is always a **404**, never a 403 — the portal must not confirm that another tenant's or customer's data exists.

6. **Build order matters.** `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md` "Build order" section is sequential and each phase must have passing CI before the next starts. Don't build Phase 3 UI against a Phase 5 adapter that doesn't exist yet.

## Commands

```
pnpm install                          # from repo root
docker compose -f docker-compose.dev.yml up -d   # local Postgres + Redis

pnpm --filter <pkg> typecheck | lint | test | build
pnpm --filter @cc/db db:push          # sync Prisma schema to local Postgres
pnpm --filter @cc/db test:isolation   # cross-tenant isolation tests (needs Postgres)
pnpm --filter @cc/service-onboarding test:integration   # onboarding flow (needs Postgres)
pnpm --filter @cc/service-catalogue test:integration    # cart flow (needs Postgres)
pnpm --filter @cc/service-identity db:seed   # dev tenants + users (see its README)
pnpm --filter @cc/ui storybook        # component development
pnpm --filter web dev                 # run the Next.js app
pnpm --filter web test:e2e            # Playwright smoke E2E (needs a build + seeded DB)

turbo run typecheck lint test build   # whole-repo, from root
```

Local sign-in: copy `apps/web/.env.example` to `apps/web/.env.local`, seed, then open `http://acme.localhost:3000/login` (the subdomain is what resolves the tenant) as `buyer@acme.example` / `portal-dev-password`.

Package names: `@cc/config`, `@cc/domain`, `@cc/db`, `@cc/ui`, `@cc/adapter-sap`, `@cc/adapter-gstn`, `@cc/adapter-storage`, `@cc/service-identity`, `@cc/service-sap`, `@cc/service-onboarding`, `@cc/service-catalogue`, `web` (apps/web). The remaining `packages/services/*`, `packages/adapters/*` and `apps/ops` are stubs (README only, no `package.json`) until their phase begins — see each README for which phase adds them.

## Where the moving parts live

- **SAP access:** `@cc/adapter-sap` owns the `SapAdapter` contract and the mock/ecc/s4 drivers. App code never imports it — it goes through `@cc/service-sap` (`getSapAdapterForTenant`), because `apps -> adapters` is not an allowed edge. Reads return `SapRead<T>` with a freshness class; render it, don't assume it (ADR-007).
- **Auth:** `@cc/service-identity` (Node) and `@cc/service-identity/edge` (middleware — no Prisma). Session cookies and env parsing live in `apps/web/lib/`.
- **Shell:** `AppShell`/`TopBar`/`Sidebar` in `@cc/ui` render whatever nav items they're given; filter with `visibleNavItems(...)` on the server first.
- **Onboarding:** `@cc/service-onboarding` owns the applicant flow and the approval queue. Applicants have no session — they hold a draft token (ADR-009), so `/api/onboarding/*` is public in `middleware.ts` while `/api/admin/onboarding/*` is not. The wizard's steps and sections are a registry (`ONBOARDING_STEPS` in `@cc/domain`), so no screen carries a field list.
- **Catalogue & cart:** `@cc/service-catalogue` owns both. Catalogue reads store nothing — they compose `SapAdapter` reads and carry their freshness. The cart stores only material + quantity and is **repriced on every read**; it is keyed per KUNNR, not per user, and survives a SAP outage unpriced (ADR-014). Price/stock load lazily per card, one request each (ADR-013). `stockAvailability()` in `@cc/domain` is the only definition of "low stock".
- **Cross-service work:** a service may not import another service. Where a flow spans two (approval = SAP create + credential issue), the route handler sequences them and passes adapters in — ADR-011.

## Conventions

- TypeScript `strict`, no `any` without a comment explaining why (see the `no-explicit-any` rule in `packages/config/eslint/base.js`).
- Conventional Commits, small PR-sized commits.
- Every package gets a `README.md`: purpose, public API, how to test.
- When a doc is genuinely ambiguous: pick the option most consistent with contract-first / tenant-safe / mock-first, record it in `docs/DECISIONS.md` (one entry per decision, ADR-style, newest first), and keep going — don't stall on it.
