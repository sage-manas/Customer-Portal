# @cc/service-platform

The platform operator console's backend (docs/07 B5, `apps/ops`).
Framework-free, like every service (ADR-002).

## Public API

- `operatorLogin`, `setOperatorPassword`, `requireOperatorSession` — the
  operator realm's auth, entirely separate from `@cc/service-identity`'s
  tenant sessions (docs/DECISIONS.md ADR-045: distinct JWT issuer/audience,
  distinct `Operator` table, distinct password-hashing copy).
- `requireOperatorPermission` (`guard.ts`) — the console's enforcement
  point, reading the _same_ `ROLE_PERMISSIONS` registry the portal does
  (ADR-051). The realms stay separate in who may hold a role, not in what a
  permission means: `verifyOperatorToken` and `operatorLogin` both filter
  roles through `isPlatformRole`, so a tenant role can never arrive here.
  Its own file with no `@cc/db` import, so the matrix test runs without
  Postgres.
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
- `updateTenant`, `setTenantActive` — tenant editing and **soft**
  deactivation. There is no delete and there will not be one (ADR-054): a
  tenant's O2C rows are the portal's side of documents SAP has posted.
  Deactivation is a flag; `@cc/service-identity`'s `login` is what refuses
  the sign-in, because that is identity's decision to make (rule 1).
- `listOperators`, `createOperator`, `setOperatorActive` — console-login
  management. The plane constraint is enforced here for the third time
  (after the token parse and `operatorLogin`, ADR-051): a tenant role is
  refused at the _write_, not just at the read. `setOperatorActive` will not
  deactivate the caller, nor the last active operator holding
  `platform:operators-manage` — the console has no way back in from either.
- `getTenantSapConfig`, `updateTenantSapConfig`, `testSapConnection` — the
  per-tenant SAP connection (ADR-053). Fields come from
  `SAP_CONNECTION_FIELDS` in `@cc/domain`, values from the B1 envelope vault
  (ADR-042), and **secrets are write-only**: a read returns whether one is
  set, never what it is. `testSapConnection` takes a structural
  `{ health() }` probe rather than building an adapter, because
  `@cc/service-sap` owns resolution and a service may not import another —
  the ops route handler sequences the two (ADR-011).
- `recordSapConfigAudit`, `listSapConfigAudit` — the append-only
  configuration trail. Field _names_ only, never values: an audit table is
  read more widely than the vault and is not encrypted at rest. Append-only
  is a property of this module exporting no mutation, not a database
  constraint.

## Why this package exists rather than extending `@cc/service-identity`

An operator manages tenants; a tenant session is scoped to one. Reusing
`User`/`SessionClaims` would mean either inventing a fake "platform" tenant
for operators to belong to, or making the one genuinely tenant-less login
table pretend to carry a `tenantId` — both worse than a second, smaller
realm. See ADR-045 for the full reasoning, including why the password/JWT
code below is a deliberate copy rather than a shared import.

## How to test

```
pnpm --filter @cc/service-platform test              # password/JWT units + the ops route×role matrix, no database
pnpm --filter @cc/service-platform test:integration   # provisioning, health/usage, SAP config + trail, needs Postgres
pnpm --filter @cc/service-platform db:seed            # dev operator logins (one per platform role)
```
