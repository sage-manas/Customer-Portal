# @cc/db

Prisma schema, generated client, and the tenant-isolation layer every DB call goes through. Depends only on `@cc/domain` conceptually (JSON columns mirror domain schemas) — no service or UI code lives here.

## Tenancy model (docs/DECISIONS.md ADR-003)

Single Postgres schema, row-level `tenantId` on every tenant-owned table. Two pieces make scoping structural instead of a convention:

- **`tenant-context.ts`** — an `AsyncLocalStorage`-backed `runWithTenant(tenantId, fn)`. Call this once per request (from the resolved subdomain + JWT `tenantId` claim). `getTenantId()` throws if nothing is bound.
- **`tenant-middleware.ts`** — a Prisma Client Extension (`withTenantScoping`) that auto-injects `tenantId` into `where`/`data`/`create` for every operation against a model listed in `TENANT_SCOPED_MODELS`. A query against a tenant-scoped model with no bound context throws before it reaches Postgres.

Always import `db` from `./client` (or the package root) — never instantiate `PrismaClient` directly, or scoping is bypassed.

## Adding a new tenant-owned model

1. Add the model to `prisma/schema.prisma` with a `tenantId String` column (+ `@@index([tenantId])`).
2. Add its Prisma model name to `TENANT_SCOPED_MODELS` in `src/tenant-middleware.ts`.
3. Run `pnpm --filter @cc/db db:push` (dev) or add a migration.
4. Add an isolation-test case in `src/__tests__/tenant-isolation.test.ts` covering it.

## Local development

```
docker compose -f ../../docker-compose.dev.yml up -d postgres
cp .env.example .env
pnpm --filter @cc/db db:push
pnpm --filter @cc/service-identity db:seed   # dev tenants + users
```

The seed lives in `@cc/service-identity`, not here: it writes credentials, and the password-hash format belongs to the identity service — `db -> services` is not an allowed dependency (`docs/DECISIONS.md` ADR-008).

## How to test

```
pnpm --filter @cc/db test:isolation   # requires DATABASE_URL (real Postgres)
```

CI runs this against a Postgres service container — see `.github/workflows/ci.yml`.
