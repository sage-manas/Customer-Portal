# @cc/ui

Design tokens, shadcn-style primitives, and the domain components that make this product recognizable (`SapField`, `StatusBadge`, `DataTable`, `Money`, `DocumentNumber`). May depend on `@cc/domain` and `@cc/config` only — never on `apps/*` or `packages/services/*` (docs/06, docs/DECISIONS.md ADR-004).

## Public API

Import everything from the package root: `import { AppShell, PageHeader, Button, StatusBadge, Money, DataTable, SapField, DocumentNumber, SapSyncIndicator, KpiCard } from "@cc/ui"`. Also exports `./globals.css` (Tailwind directives + `tokens.css`) for apps to import once at the root layout.

## Tokens

`src/tokens.ts` is the single source of truth for token values (docs/05-UI-UX-DESIGN.md §2.1). `src/tokens.css` mirrors them as CSS custom properties so the Tailwind preset (`@cc/config/tailwind/preset`) can reference them by name without importing `@cc/ui` (that would be a cycle — `config` has zero dependencies). `tokens.test.ts` fails if the two drift.

## Domain components

- **`SapField`** — wraps `Input` with a field's SAP contract (`docs/03-FUNCTIONAL-SPEC.md` mapping): label + `REQ` chip, type/length-derived input, and a `specMode` footer (table/field/type/length) hidden from end customers by default.
- **`StatusBadge`** — renders a `CanonicalStatus` from `@cc/domain/status`. Never pass a raw SAP code; translate it with a mapper (e.g. `mapOrderGbstkToStatus`) first — the raw-code-to-color mapping lives in exactly one place.
- **`DataTable`** — TanStack Table wrapper with server pagination/sorting hooks and built-in loading/empty/error states.
- **`Money`** — en-IN lakh/crore formatting, mono, debit/credit tone.
- **`DocumentNumber`** — the primary cross-document navigation affordance; mono, copy-on-hover, optional deep link.
- **`SapSyncIndicator`** / **`StaleDataBanner`** — freshness display (docs/05 §6.1): `live` / `cached` / `stale` / `pending`. Pass the `freshness` value that came back on the SAP read; never decide it in the screen. Status is never colour-only — each state carries a label.
- **`KpiCard`** — dashboard tile with module-accent wash, trend line, click-through, plus `KpiCardSkeleton` for the loading state.

## App shell

`AppShell` (top bar + sidebar + scrollable content, max 1440px) serves both the customer portal and the tenant back-office — only the nav items differ (docs/05 §5, §8). `PageHeader` is the standard screen header (title, subtitle, freshness meta, actions).

`Sidebar` renders exactly the items it is given: filter them with `visibleNavItems()` from `@cc/domain` on the server, so RBAC and tenant module toggles are applied in one place. Modules that aren't built yet render disabled with a "Soon" chip rather than disappearing — doc 05 §4.2 fixes the module order, and a nav that changes shape every phase disorients pilot tenants. `nav-icons.ts` is the only place the domain layer's icon _names_ meet Lucide components, which is what keeps `@cc/domain` free of UI dependencies.

## Storybook

```
pnpm --filter @cc/ui storybook
```

Every domain component ships a story per meaningful state (default, spec-mode, error, loading, empty — per component). Primitives get at least one story per variant.

## How to test

```
pnpm --filter @cc/ui test        # token/logic unit tests
pnpm --filter @cc/ui typecheck
pnpm --filter @cc/ui build-storybook
```
