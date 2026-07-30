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

## The transactional outbox (`src/outbox.ts`, docs/DECISIONS.md ADR-023)

Asynchronous work is produced here and nowhere else. A service records an effect by calling `writeOutboxEvent(tx, …)` **inside the same `db.$transaction` as the state change that justifies it** — one commit, so an event can neither be lost after its cause committed nor fired for a transaction that rolled back.

```ts
await runWithTenant(tenantId, () =>
  db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id }, data: { state: "captured" } });
    await writeOutboxEvent(tx, {
      name: "payment.captured", // a DomainEventName from the @cc/domain registry
      payload: { occurredAt: new Date(), paymentId: id, kunnr, amount, currency },
      dedupeKey: `payment.captured:${id}`, // producer-side idempotency
    });
  }),
);
```

- The payload is validated against the event's registered Zod schema, so a malformed event fails at the producer.
- `dedupeKey` is unique per tenant: a producer that runs twice writes the same key and the second write is a **no-op**, not an error (a retried webhook must not fail the operation it's attached to). Key it on the cause, never a timestamp.
- `recordEvent(...)` is the shorthand for the no-transaction case.
- Nothing here publishes. The relay in `@cc/workers` is the only thing that talks to BullMQ; this package never imports it (`db -> domain, config` only).

## The bell inbox is stored; almost nothing else derived is (ADR-039)

`Notification` is the one table in the repo that holds words rendered from a domain event. It is not the mirror ADR-016 forbids: "we told this user at 09:04 and they read it at 11:20" is derivable from nothing, and re-rendering it later from the current document would produce different words than the customer was actually shown. It keeps a relative `href` and deliberately nothing else about the document — clicking re-reads through the owning module, with that module's KUNNR check and its own freshness.

## The tenant credential vault (`src/credentials/`, docs/DECISIONS.md ADR-042)

Per-tenant SAP/GSTN/payment-gateway connection secrets are envelope-encrypted, never inlined. Two layers, both AES-256-GCM:

- **`TenantDataKey`** — one row per tenant, a random 256-bit key wrapped by the platform master key.
- **`TenantCredential`** — one row per tenant per `CredentialSystem` (`sap` | `gstn` | `payment_gateway`), the credential JSON sealed under that tenant's data key.

```ts
import { getTenantCredential, setTenantCredential, runWithTenant } from "@cc/db";

await runWithTenant(tenantId, () =>
  setTenantCredential(tenantId, "sap", { username: "svc", password: "..." }),
);

const credential = await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));
// -> { username: "svc", password: "..." } | null (null = nothing stored yet, not an error)
```

Both models are tenant-scoped like any other table here (`TENANT_SCOPED_MODELS`), so every call needs `runWithTenant` — the three resolvers this is built for (`@cc/service-sap`, `@cc/service-payment`, `@cc/service-onboarding`'s GSTN resolver) each bind their own context around the vault read rather than assuming a caller already did.

The master key's custody is a `MasterKeyProvider` (`src/credentials/master-key.ts`) — an interface with an `env` driver (base64 key in `CREDENTIAL_MASTER_KEY`, local-dev only) built first and a `kms` driver deferred like ADR-006's SAP skeletons, following the same "external system behind an interface" shape as SAP/GSTN/the payment gateway (CLAUDE.md rule 2). Generate a dev key with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

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
