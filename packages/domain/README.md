# @cc/domain

Pure TypeScript: entities, the canonical status registry, and the SAP field-mapping registry. **No I/O** — no Prisma, no fetch, no filesystem. Per the monorepo dependency rule (`docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`), `domain` imports nothing else in the workspace; everything else may import `domain`.

## Public API

- `sap-mapping/` — `SapFieldDef`/`SapMappingRegistry` types, the `onboardingMapping` and `orderMapping` registries (seeded verbatim from `docs/03-FUNCTIONAL-SPEC.md`), and `buildZodSchema(registry, mode)` which derives a Zod schema from a registry instead of hand-writing validation per screen.
- `status.ts` — the canonical status enum (`docs/05-UI-UX-DESIGN.md` §6.5), the `statusBadgeVariant` map consumed by the UI's `StatusBadge`, and per-source mappers (e.g. `mapOrderGbstkToStatus`) that translate raw SAP codes to canonical statuses.
- `entities/` — `Tenant`, `OnboardingApplication`, `SalesOrder` — built on top of the registries above, not duplicating their field lists.

## Adding a new module's mapping

1. Add `src/sap-mapping/<module>.ts` exporting a `SapFieldDef[]` sourced from `docs/03-FUNCTIONAL-SPEC.md`.
2. Export it from `src/sap-mapping/index.ts`.
3. Derive write/read Zod schemas with `buildZodSchema` — do not hand-write field validators.
4. If the module introduces new SAP status codes, add a `map<Field>ToStatus` function in `status.ts`.

## How to test

```
pnpm --filter @cc/domain test
```

Vitest unit tests cover schema derivation (required/optional/length rules) and status mapping. Target ≥80% coverage on business logic per `docs/06`.
