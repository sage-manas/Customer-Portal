# @cc/service-platform

The platform operator console's backend (docs/07 B5, `apps/ops`).
Framework-free, like every service (ADR-002).

## Public API

- `operatorLogin`, `setOperatorPassword`, `requireOperatorSession` — the
  operator realm's auth, entirely separate from `@cc/service-identity`'s
  tenant sessions (docs/DECISIONS.md ADR-045: distinct JWT issuer/audience,
  distinct `Operator` table, distinct password-hashing copy).
- `issueOperatorTokens`, `verifyOperatorToken` (also exported from the
  `./edge` subpath for `apps/ops/middleware.ts`, which runs on the edge
  runtime and cannot import anything that touches `@cc/db`).
- `createTenant`, `listTenants`, `getTenant` — provisioning. `createTenant`
  creates the `Tenant` row and its first `client_admin` `User` in one call;
  it is not `@cc/service-identity`'s `provisionPortalAccess` (that issues a
  _buyer_ login against an existing SAP KUNNR, and a service may not import
  another service, CLAUDE.md rule 1).
- `getTenantHealth` — SAP driver + outbox queue depth/exceptions, composed
  per tenant on every read (never stored — ADR-037/ADR-044's reasoning).
- `getTenantUsage` — composed counts (users, orders, tickets, payments),
  a read-model rather than a projection table for the same reason.
- `getTenantBilling` — the plan comparison, behind `@cc/adapter-billing`'s
  mock driver until a real provider exists.

## Why this package exists rather than extending `@cc/service-identity`

An operator manages tenants; a tenant session is scoped to one. Reusing
`User`/`SessionClaims` would mean either inventing a fake "platform" tenant
for operators to belong to, or making the one genuinely tenant-less login
table pretend to carry a `tenantId` — both worse than a second, smaller
realm. See ADR-045 for the full reasoning, including why the password/JWT
code below is a deliberate copy rather than a shared import.

## How to test

```
pnpm --filter @cc/service-platform test              # password/JWT units, no database
pnpm --filter @cc/service-platform test:integration   # provisioning + health/usage, needs Postgres
pnpm --filter @cc/service-platform db:seed            # dev operator logins (one per platform role)
```
