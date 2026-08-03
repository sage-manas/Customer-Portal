# @cc/domain

Pure TypeScript: entities, the canonical status registry, and the SAP field-mapping registry. **No I/O** — no Prisma, no fetch, no filesystem. Per the monorepo dependency rule (`docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`), `domain` imports nothing else in the workspace; everything else may import `domain`.

## Public API

- `sap-mapping/` — `SapFieldDef`/`SapMappingRegistry` types, the `onboardingMapping` and `orderMapping` registries (seeded verbatim from `docs/03-FUNCTIONAL-SPEC.md`), and `buildZodSchema(registry, mode)` which derives a Zod schema from a registry instead of hand-writing validation per screen.
- `status.ts` — the canonical status enum (`docs/05-UI-UX-DESIGN.md` §6.5), the `statusBadgeVariant` map consumed by the UI's `StatusBadge`, and per-source mappers (e.g. `mapOrderGbstkToStatus`) that translate raw SAP codes to canonical statuses.
- `entities/` — `Tenant`, `OnboardingApplication`, `SalesOrder`, plus the canonical shapes the SAP adapter exchanges (`CanonicalCustomer`, `CreditInfo`, `Material`, `StockLevel`, `CustomerPrice`, `CreateSalesOrderInput`, `OrderStatusView`, `Delivery`, `Invoice`, `OpenItem`, …) — built on top of the registries above, not duplicating their field lists. These carry `CanonicalStatus`, never raw SAP status codes: drivers translate before returning.
- `auth.ts` — the role/permission registry (`docs/02` §3, `docs/05` §4.3): `ROLES`, `PERMISSIONS`, `ROLE_PERMISSIONS`, `SessionClaims`, `hasPermission` and the inverse `rolesWithPermission` (which lets a fan-out filter recipients in SQL rather than in a loop). Nothing in the codebase compares roles directly; it asks for a permission, so adding a role never means hunting down `if`s.
- `validation/india.ts` — the statutory validators SAP data types can't express (docs/05 §6.2): PAN, GSTIN **with its check digit**, IFSC, PIN, phone, plus the GST state-code table (T005S region codes) and the select lists for state, GST registration type and account group.
- `entities/onboarding.ts` — the wizard **is** a registry: `ONBOARDING_STEPS` declares which registry fields belong to which step and section, `onboardingStepSchema(step)` derives that step's Zod schema, `onboardingCrossFieldIssues` holds the rules that need several steps at once (GSTIN ↔ PAN ↔ state), and `ONBOARDING_TRANSITIONS` is the workflow state machine as data.
- `entities/notification.ts` — the notification template registry (docs/05 §6.4, A7): `event name -> templates`, each declaring an audience, the permission its recipients must hold, its channels, its severity and its copy, plus `renderNotifications` which applies them to a payload. Keyed by `DomainEventName`, so a notification can only describe something that already happened. The map is **partial on purpose** — an event with no template is deliberately silent, and the worker subscribes by looping over the registry (ADR-040).
- `navigation.ts` — the nav registry behind the sidebar (`docs/05` §4.1/§4.2): route, label, Lucide icon _name_, module accent, required permission, and build status per item, plus `visibleNavItems` (RBAC + tenant module toggles) and `activeNavItem` (longest-prefix match).

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
