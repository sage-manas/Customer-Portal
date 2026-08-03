# ops (platform operator console)

Docs/07 B5: "minimal but real" — operator auth in its own realm, a tenant
provisioning wizard, a tenant health dashboard, and a usage read-model, with
billing behind a stubbed interface. See `docs/DECISIONS.md` ADR-045 for why
this is a wholly separate realm from `apps/web`'s tenant sessions rather than
a `User` row with a platform role.

## What's here

- `middleware.ts` — verifies the `cc_ops_access` cookie against
  `@cc/service-platform/edge`'s `verifyOperatorToken`. No tenant/host
  resolution (an operator isn't scoped to a tenant) and no per-route
  permission split (there is exactly one operator role).
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

`pnpm --filter @cc/service-platform db:seed` upserts a dev operator
(`operator@platform.example` / `ops-dev-password`), the same idempotent,
production-refusing shape as `@cc/service-identity`'s tenant seed.

## How to test

`pnpm --filter ops dev` runs on port 3100 (apps/web owns 3000). There is no
Playwright suite yet — `pnpm --filter @cc/service-platform test:integration`
covers provisioning, health and usage against a real database.
