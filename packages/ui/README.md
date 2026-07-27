# @cc/ui

Design tokens, shadcn-style primitives, and the domain components that make this product recognizable (`SapField`, `StatusBadge`, `DataTable`, `Money`, `DocumentNumber`). May depend on `@cc/domain` and `@cc/config` only — never on `apps/*` or `packages/services/*` (docs/06, docs/DECISIONS.md ADR-004).

## Public API

Import everything from the package root: `import { AppShell, PageHeader, Button, Select, Textarea, StatusBadge, Money, DataTable, SapField, DocumentNumber, SapSyncIndicator, KpiCard, WizardShell, FormSection, FileUpload, ComplianceBadge, DecisionGate, StockChip, QtyStepper, ProductCard, CartDrawer, CartButton } from "@cc/ui"`. Also exports `./globals.css` (Tailwind directives + `tokens.css`) for apps to import once at the root layout.

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
- **`WizardShell`** / **`FormSection`** — the multi-step frame (docs/05 §3.2): step indicator, Save Draft, Back/Continue, doc-level error slot. Deliberately stateless — validation, autosave and the exit guard belong to the page that knows what a step means. `FormSection` is the 3-column form grid with its section label.
- **`FileUpload`** — drag-drop with type/size validation, uploading/scanning/uploaded/error states. A client component. Its caps come from `@cc/config`, the same constants the storage adapter enforces server-side, so the hint and the rule cannot drift.
- **`ComplianceBadge`** — GSTIN / IRN / e-way bill as trust signals (docs/05 P5), with copy and a verified/failed state. The state is _reported_ by the caller, never inferred from the string: a tick nobody earned is a false compliance claim.
- **`DecisionGate`** — pass/fail check list for approval and process-flow screens, so a reviewer decides against evidence rather than a wall of fields.
- **`StockChip`** — In stock / Low / Out (docs/05 §7.2). Renders a `StockAvailability`; it never classifies a quantity itself — `stockAvailability()` in `@cc/domain` is the single authority, so the card, the drawer and the plant table cannot disagree about "low".
- **`QtyStepper`** — MOQ-aware quantity control: MVKE-MINBM is both the floor and the step. A courtesy check, not the control — the cart service and SAP enforce it again.
- **`ProductCard`** — catalogue card with MATNR in mono, "your price", stock chip, stepper and Add to Cart. Price and stock are **optional props** because doc 05 requires them to load lazily per card; pass `pricingLoading` for the skeleton.
- **`CartDrawer`** / **`CartButton`** — the persistent cart drawer with line edit, per-line issue rendering, and the split CTA (Request Quote vs Create Order). It renders the issues the service computed and decides nothing.

`SapField` also renders a `<select>` when given `options`; the lists themselves (state codes, GST registration types, account groups) come from `@cc/domain`, never from the component.

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
