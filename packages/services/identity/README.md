# @cc/service-identity

Authentication, session tokens, tenant resolution and RBAC enforcement (`docs/02-TRD-ARCHITECTURE.md` §3). Framework-free — no Next.js imports — so the BFF route handlers stay thin adapters (docs/DECISIONS.md ADR-002).

## Public API

```ts
// Node runtime (route handlers): everything, including DB-backed calls.
import { login, switchAccount, setPassword, findTenantByHost } from "@cc/service-identity";

// Edge runtime (middleware): pure/WebCrypto subset only.
import { verifyToken, resolveTenantFromHost, hostMatchesSession } from "@cc/service-identity/edge";
```

| Export                                                                                   | Purpose                                                                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `login({ email, password, tenantSlug })`                                                 | Credentials login; returns `SessionClaims`, a `TokenPair`, the tenant, and `mustChangePassword`.     |
| `switchAccount(session, kunnr)`                                                          | Changes the active sold-to account and re-issues tokens; the link is re-checked in the DB.           |
| `setPassword(session, newPassword)`                                                      | First-login change / self-service reset.                                                             |
| `findTenantByHost` / `findTenantBySlug`                                                  | Tenant lookup for host-based resolution.                                                             |
| `issueTokens` / `verifyToken`                                                            | HS256 access (30 min) + refresh (7 d) JWTs carrying `tenantId`, `roles`, `kunnr`, `availableKunnrs`. |
| `hashPassword` / `verifyPassword` / `needsRehash`                                        | scrypt hashing, parameters embedded in the hash string.                                              |
| `requireSession` / `requirePermission` / `requireCustomerAccount` / `resolveActiveKunnr` | RBAC guards; throw `AuthError` with an HTTP status.                                                  |
| `resolveTenantFromHost` / `hostMatchesSession`                                           | Subdomain + custom-domain resolution, and the host-vs-claim check.                                   |

## Decisions worth knowing

- **`jose`, not `jsonwebtoken`** — verification also runs in Next middleware on the edge runtime, where Node `crypto` doesn't exist. A guard that can't run in the guard's runtime isn't a guard.
- **scrypt, not bcrypt/argon2** — both are native addons, and docs/02 §8 flags native dependencies as the thing that makes managed-PaaS deploys painful. scrypt is memory-hard and in-stdlib.
- **Two entry points** — `.` pulls in `@cc/db`; `./edge` deliberately does not, so middleware never tries to load Prisma.
- **Uniform failures** — unknown address, no password set, and wrong password all return `invalid_credentials`, and the no-user path still runs a hash so timing doesn't enumerate addresses.
- **The host is a hint, the JWT is the authority.** `hostMatchesSession` mismatches are 404, never 403 — confirming another tenant's portal exists is itself a leak (docs/05 §8).

## Seeding local data

```
pnpm --filter @cc/service-identity db:seed
```

Creates two mock-driver tenants (`acme`, `globex`) with users across every role family, linked to the KUNNRs the mock SAP adapter seeds. All seeded users share the password `portal-dev-password`. Two tenants on purpose: cross-tenant isolation is only demonstrable when there is another tenant's data to fail to reach. Idempotent; refuses to run against `NODE_ENV=production`.

## How to test

```
pnpm --filter @cc/service-identity test
pnpm --filter @cc/service-identity test:integration   # needs Postgres
```

Covers hashing (salting, malformed input, rehash policy), token round-trip/tampering/expiry/type-confusion and unknown-role stripping, host resolution, and the RBAC guards — including `authz-matrix.test.ts`, the portal's route×role matrix (doc 09 §4.4, ADR-050). That suite is generated from `API_ROUTES` and `rolesWithPermission` in `@cc/domain` and runs the real `requirePermission`, so a permission moved between role groups changes what it asserts with nobody editing a test; every non-admitted role must get 403 and an anonymous caller 401. These need no database. The one decision `login` makes that only a real database can prove has its own Postgres-backed suite (`src/__tests__/tenant-deactivation.test.ts`): a tenant deactivated from the operator console is refused with `tenant_inactive`, reactivating restores access, and nothing the tenant owns is deleted either way (ADR-054). It lives here rather than beside `setTenantActive` because refusing a sign-in is identity's decision, and a service may not import another to make somebody else's. The remaining DB-backed flows are exercised end to end from `apps/web`.
