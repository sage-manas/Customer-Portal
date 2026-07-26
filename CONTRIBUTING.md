# Contributing

## Repo shape

```
apps/
  web/          customer portal + tenant back-office (Next.js)
  ops/          platform operator console (stub — see apps/ops/README.md)
packages/
  ui/           design tokens, primitives, domain components (Storybook)
  domain/       pure TS: entities, status registry, SAP-mapping registry — no I/O
  services/     business logic per module — identity/, sap/ built; rest per phase
  adapters/     sap/ built (contract + mock/ecc/s4 drivers); GSTN/e-invoice/e-way/
                gateway/notification adapters per phase
  db/           Prisma schema, tenant-scoped middleware, isolation tests
  config/       eslint, tsconfig, tailwind preset, shared constants (no product logic)
docs/           product/architecture docs + docs/DECISIONS.md (ADR log)
```

## Dependency boundaries

```
domain    -> config
ui        -> domain, config
services  -> domain, adapters, db, config
adapters  -> domain, config            (never services)
db        -> domain, config
apps      -> ui, services, domain, config
```

Nothing imports from `apps`. `config` has no dependencies of its own. This is enforced by `eslint-plugin-boundaries` (`packages/config/eslint/base.js`) — a boundary violation is a lint error, not a style nit. If you find yourself wanting to break one of these, the fix is almost always to move the thing you need into a package both sides can already depend on (usually `domain`), not to loosen the rule. If you do need to loosen it, write an ADR (see below) explaining why.

## Adding a new module (service + SAP mapping)

Using Sales Order as the template (`packages/domain/src/sap-mapping/order.ts`, `packages/domain/src/entities/order.ts`):

1. **Registry**: add `packages/domain/src/sap-mapping/<module>.ts` — a `SapFieldDef[]` sourced from `docs/03-FUNCTIONAL-SPEC.md`. Export it from `sap-mapping/index.ts`.
2. **Schema**: derive Zod schemas with `buildZodSchema(registry, "write" | "read")` — don't hand-write field validators.
3. **Entity**: add `packages/domain/src/entities/<module>.ts` building on the schema/registry.
4. **Status**: if the module introduces new SAP status codes, add a `map<Field>ToStatus` function to `packages/domain/src/status.ts` and extend `CANONICAL_STATUSES`/`statusBadgeVariant` if needed.
5. **DB**: add the Prisma model(s) with a `tenantId` column, register the model name in `TENANT_SCOPED_MODELS` (`packages/db/src/tenant-middleware.ts`), add an isolation-test case.
6. **Adapter**: extend the `SapAdapter` interface (`packages/adapters/sap/src/contract.ts`) and its `mock` driver — with seeded data covering the unhappy paths — before writing any service code against it.
7. **Service**: add `packages/services/<module>/`, exposing a typed service interface; depends on `domain` + `adapters` + `db` only. Add it to `apps/web`'s dependencies and to `transpilePackages` in `next.config.mjs`.
8. **Permissions**: add the module's permissions to `packages/domain/src/auth.ts`, grant them to the right roles, and add its nav entry (route, icon, accent, permission) to `packages/domain/src/navigation.ts` — flipping `status` from `planned` to `live` when the screens land. Guard the route handlers with `requirePermission`.
9. **UI**: screens under `apps/web/app/(portal)/<module>/...`, built from `SapField`/`DataTable`/`StatusBadge`/etc. inside the `AppShell`, matching `docs/05-UI-UX-DESIGN.md`. Render the freshness that came back on the SAP read (`SapSyncIndicator`); never assume it.

## Recording a decision (ADR)

When a doc is ambiguous or silent and you have to choose, add an entry to `docs/DECISIONS.md` (newest first): what the ambiguity was, what you decided, why, and the consequence. Don't stall waiting for sign-off — pick the option most consistent with contract-first / tenant-safe / mock-first and keep moving.

## Engineering standards (see `CLAUDE.md` for the condensed version)

TypeScript `strict`, no `any` without a justifying comment; Conventional Commits; every package has a `README.md`; tests before marking a module done (service tests green, Storybook states complete, isolation tests green where applicable).
