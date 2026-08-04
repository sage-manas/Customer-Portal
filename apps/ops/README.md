# ops (platform operator console)

Docs/07 B5: "minimal but real" — operator auth in its own realm, a tenant
provisioning wizard, a tenant health dashboard, and a usage read-model, with
billing behind a stubbed interface. See `docs/DECISIONS.md` ADR-045 for why
this is a wholly separate realm from `apps/web`'s tenant sessions rather than
a `User` row with a platform role.

## What's here

- `middleware.ts` — verifies the `cc_ops_access` cookie against
  `@cc/service-platform/edge`'s `verifyOperatorToken`, then gates on
  `platform:operate` — the console's mirror of `apps/web`'s `admin:view`
  check. No tenant/host resolution (an operator isn't scoped to a tenant).
  Like the web app's, it is a gate and not _the_ enforcement: every handler
  calls `requireOperator(permission)`, because a session that may open the
  shell is not a session that may create a tenant.
- `/login` — operator sign-in.
- `/` — tenant list with per-tenant queue depth/exceptions.
- `/tenants/new` — provisioning form: creates the `Tenant` row and its first
  `client_admin` login in one call, returns a one-time password.
- `/tenants/[id]` — health (SAP driver + outbox), usage (composed counts) and
  the billing stub.
- `/api/auth/*`, `/api/tenants*` — thin route handlers over
  `@cc/service-platform`.

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
billing — and as of Phase 3 that difference is real: the operator token
carries platform roles, `requireOperator(permission)` enforces them, and
`sap@platform.example` gets a 403 from `/api/tenants` (ADR-051). The
_screens_ that make `sap_manager` useful rather than merely restricted —
SAP config, SAP health, the config audit trail — are Phase 4 of
`docs/09-RBAC-RESTRUCTURE-PLAN.md`.

## How to test

`pnpm --filter ops dev` runs on port 3100 (apps/web owns 3000).
`pnpm --filter ops test` runs the authz sweep, which checks every handler
here against `API_ROUTES` in `@cc/domain` — an undeclared route or a guard
naming a permission its registry row doesn't fails CI. The route×role
matrix itself lives with the guard it executes, in
`packages/services/platform/src/authz-matrix.test.ts`. There is no
Playwright suite yet — `pnpm --filter @cc/service-platform test:integration`
covers provisioning, health and usage against a real database.
