# ops (platform operator console)

Docs/07 B5 built it "minimal but real" — operator auth in its own realm, a
tenant provisioning wizard, a health dashboard and a usage read-model. Doc
09 §3.3 (Phase 4) made it a two-role console: `super_admin` runs tenants,
operators and billing; `sap_manager` runs every tenant's SAP connection and
nothing else. See `docs/DECISIONS.md` ADR-045 for why this is a wholly
separate realm from `apps/web`'s tenant sessions, and ADR-051–054 for the
role model, the guards, the SAP configuration screen and tenant
deactivation.

## What's here

- `middleware.ts` — verifies the `cc_ops_access` cookie against
  `@cc/service-platform/edge`'s `verifyOperatorToken`, then gates on
  `platform:operate` — the console's mirror of `apps/web`'s `admin:view`
  check. No tenant/host resolution (an operator isn't scoped to a tenant).
  Like the web app's, it is a gate and not _the_ enforcement.
- **Three layers of enforcement, each covering a different moment.**
  `requireOperator(permission)` (`lib/route.ts`) guards every handler.
  `requireOperatorPage(permission)` (`lib/page-guard.ts`) guards every
  server-rendered screen, because a page that reads a service directly
  gives the route guard nothing to fire on (ADR-052). `visibleNavItems`
  over `OPS_NAV` decides what a session is offered — presentation, not
  control.
- `/login` — operator sign-in, outside the console shell.
- `/` — forwards to the first nav item the session can open. Not the tenant
  list: `sap_manager` cannot see that, and a landing page that 403s for a
  whole role reads as a broken console.
- `/tenants`, `/tenants/new`, `/tenants/[id]` — `platform:tenant-crud`.
  Provisioning, health/usage/billing per tenant, editing, and soft
  deactivation behind a dialog that names its consequences and asks for the
  slug (ADR-054). There is no delete.
- `/sap/config`, `/sap/config/[id]` — `platform:sap-config`, both platform
  roles. Driver selection and connection parameters rendered from
  `SAP_CONNECTION_FIELDS` in `@cc/domain` (no field is named in the form),
  stored through the B1 envelope vault, with a "Test connection" action and
  the append-only configuration trail on the same screen. Secrets are
  write-only: the form shows "Set", never a value (ADR-053).
- `/sap/health` — `platform:sap-health`. The B5 read-model per tenant _plus_
  a live `adapter.health()` probe, reported separately: the read-model says
  which driver a tenant chose, the probe says whether it answered.
- `/operators` — `platform:operators-manage`. Create a console login (with a
  one-time password), deactivate one. Role choices come from
  `ROLES.filter(isPlatformRole)`, so a tenant role cannot be offered.
- `/billing` — `platform:billing`. Still a stub over `@cc/adapter-billing`,
  and the screen says so; it has no API route at all, which is why the
  matrix test excludes it by name.
- `/api/*` — thin route handlers over `@cc/service-platform`. The SAP
  handlers additionally resolve an adapter from `@cc/service-sap` and pass
  it in: a service may not import another service (ADR-011).

## Environment

Copy `apps/web/.env.example`'s `DATABASE_URL`, and set a **different**
`OPS_AUTH_SECRET` (32+ chars) — sharing `AUTH_SECRET` with `apps/web` would
undo the point of a separate realm.

## Seeding an operator

`pnpm --filter @cc/service-platform db:seed` upserts one dev operator per
platform role (`operator@platform.example` = `super_admin`,
`sap@platform.example` = `sap_manager`, both `ops-dev-password`), the same
idempotent, production-refusing shape as `@cc/service-identity`'s tenant
seed. Two rows because the difference between the roles is only
demonstrable when a login exists that _cannot_ reach tenant CRUD or
billing. Sign in as `sap@platform.example` and the sidebar has exactly two
tabs; `/tenants` redirects to `/403` and `/api/tenants` answers 403.

## How to test

`pnpm --filter ops dev` runs on port 3100 (apps/web owns 3000).
`pnpm --filter ops test` runs the authz sweep, which checks every handler
here against `API_ROUTES` in `@cc/domain` — an undeclared route, or a guard
naming a permission its registry row doesn't, fails CI. The route×role
matrix lives with the guard it executes, in
`packages/services/platform/src/authz-matrix.test.ts`, and asserts both
halves of doc 09 §5's SAP-manager criterion: exactly the SAP permissions
reachable, and tenant CRUD/operator management refused. There is no
Playwright suite yet (Phase 7) —
`pnpm --filter @cc/service-platform test:integration` covers provisioning,
health, usage, the SAP configuration round trip and the audit trail against
a real database.
