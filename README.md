# CustomerConnect Portal

Multi-tenant, SAP-integrated B2B Customer Self-Service Portal SaaS covering the full Order-to-Cash cycle for Indian enterprises (GST/e-invoice/e-way-bill compliant). See `docs/00-PORTAL-OVERVIEW.md` for what this is and `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md` for how it's being built.

## Status

**Phase 1 — SAP mock adapter + auth**, per `docs/04-ROADMAP-ZERO-TO-PRODUCTION.md`. On top of the Phase 0 foundation (monorepo, tenant-isolated database layer, domain registries, first UI components) this phase adds:

- the `SapAdapter` contract with a full **mock driver** (seeded materials, stock, customer-specific pricing, orders incl. credit hold, deliveries, invoices, AR) plus `ecc`/`s4` skeletons and a per-tenant factory — `packages/adapters/sap`;
- credentials auth: scrypt hashing, JWT sessions carrying `tenantId`/`roles`/`kunnr`, subdomain tenant resolution, and RBAC guards — `packages/services/identity`, enforced in `apps/web/middleware.ts`;
- the app shell (top bar, collapsible sidebar, account switcher) and the Customer Dashboard rendering live mock-SAP data with honest freshness indicators.

Feature modules start in Phase 2 with Onboarding.

## Repo shape

See `CONTRIBUTING.md` for the full package layout and dependency rules.

## Quick start

```
pnpm install
docker compose -f docker-compose.dev.yml up -d      # Postgres + Redis
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @cc/db db:push
pnpm --filter @cc/service-identity db:seed   # dev tenants +
users

pnpm --filter ops dev              #operators/super-admin,sap-manager
pnpm --filter web dev            # http://acme.localhost:3000/login
                                 # buyer@acme.example / portal-dev-password
pnpm --filter @cc/ui storybook   # http://localhost:6006
```

Sign in on the **subdomain** (`acme.localhost`), not bare `localhost` — the tenant is resolved from the host.

### On a machine with little free RAM

`next dev` holds the compiler in memory and compiles each route on first visit; with a browser open too, that is roughly a gigabyte. If the dev server dies with `FATAL ERROR: NewSpace::EnsureCurrentCapacity Allocation failed` — or the page never finishes loading — browse a production build instead:

```
pnpm --filter web preview        # next build && next start, ~190 MB, pages in ~30ms
pnpm --filter ops start
```

No compiler is resident and nothing compiles per request. The trade is that there is no hot reload: re-run it after changing code. `next build` itself is the memory-hungry step, so if it fails, give it more headroom with `NODE_OPTIONS=--max-old-space-size=6144`.

```
pnpm turbo run typecheck lint test build   # whole repo
```

## Docs

`docs/00` through `docs/06` are the product/architecture source of truth (overview, PRD, TRD, functional spec, roadmap, UI/UX spec, build kickoff prompt). `docs/DECISIONS.md` is the running ADR log for anything those docs left ambiguous.
