# Migration Phase 1 — `/client` frontend → `/frontend`

**Status: complete.** Every frontend route, component, style and role-based
access rule from `/client` now lives in `/frontend`, running with **no
backend, no database, no Redis and no SAP system**.

- `npx tsc --noEmit` — passes
- `npx eslint .` — 0 errors, 8 documented warnings
- `npx next build` — succeeds, 44 routes
- `npx next dev` — starts; full route sweep is green for all 7 sessions
- `npm run smoke` — 34/34 write-path checks pass

---

## 1. What `/client` actually was

`/client` is a pnpm/turbo monorepo, not a single app:

| Workspace | Contents | Migrated? |
| --- | --- | --- |
| `apps/web` | Customer portal + tenant back office (Next 15). 14.6k lines of TSX. | **Yes** — pages, layouts, components |
| `apps/ops` | Platform operator console (Next 15, port 3100). 1.7k lines. | **Yes** — folded in, routes preserved |
| `packages/ui` | Design system: tokens, primitives, 27 components, app shell | **Yes**, verbatim |
| `packages/domain` | Roles, permissions, nav registry, status registries, entities, validation, SAP field mapping | **Yes**, verbatim (minus tests) |
| `packages/config` | Tailwind preset + locale constants | **Yes** (frontend parts) |
| `packages/adapters/sap` | SAP contract + **mock driver and seeded landscape** | **Partly** — mock only (see §4) |
| `packages/services/*` (17) | Business services over Prisma/Redis/SAP/gateways | **No** — replaced by mocks |
| `packages/db`, `packages/workers`, `packages/observability`, other adapters | Prisma, queues, cron, OTel, Sentry, storage, GSTN, payments | **No** — out of scope |
| `apps/web/app/api/**` (67 route handlers), `apps/ops/app/api/**` (9) | The BFF | **No** — replaced by a server-action router |

---

## 2. Routes

Every route below exists in `/frontend` and renders. **Zero frontend pages
were intentionally left behind.**

### Public

| Route | Roles | UI | Backend dependency | Status |
| --- | --- | --- | --- | --- |
| `/login` | anonymous | Migrated + demo account picker added | Demo auth (no API) | ✅ |
| `/register` | anonymous | Migrated (5-step wizard) | Mocked onboarding | ✅ |
| `/register/status` | anonymous | Migrated | Mocked onboarding | ✅ |
| `/403` | any | Migrated verbatim | — | ✅ |
| `/404`, `not-found` | any | Migrated verbatim | — | ✅ |

### Customer plane (`(portal)`) — all require `customer` role permissions

| Route | Permission | Backend dependency | Status |
| --- | --- | --- | --- |
| `/` (dashboard) | `dashboard:view` | Mocked reporting over seeded SAP | ✅ |
| `/catalogue` | `catalogue:view` | Mocked catalogue | ✅ |
| `/catalogue/[matnr]` | `catalogue:view` | Mocked catalogue | ✅ |
| `/catalogue/price-list` | `catalogue:view` | Mocked catalogue | ✅ |
| `/inquiries` | `inquiry:view` | Mocked inquiry | ✅ |
| `/inquiries/new` | `inquiry:create` | Mocked inquiry + drafts | ✅ |
| `/inquiries/[vbeln]` | `inquiry:view` | Mocked inquiry | ✅ |
| `/quotations` | `quotation:view` | Mocked inquiry | ✅ |
| `/quotations/[vbeln]` | `quotation:view` | Mocked inquiry | ✅ |
| `/orders` | `order:view` | Mocked order | ✅ |
| `/orders/new` | `order:create` | Mocked order + ATP simulation | ✅ |
| `/orders/[vbeln]` | `order:view` | Mocked order | ✅ |
| `/deliveries` | `delivery:view` | Mocked delivery | ✅ |
| `/deliveries/[vbeln]` | `delivery:view` | Mocked delivery | ✅ |
| `/deliveries/[vbeln]/pod` | `delivery:confirm-receipt` | Mocked POD (no file storage) | ✅ |
| `/invoices` | `invoice:view` | Mocked invoice | ✅ |
| `/invoices/notes` | `invoice:view` | Mocked invoice | ✅ |
| `/invoices/[vbeln]` | `invoice:view` | Mocked invoice; **PDF unavailable** | ✅ |
| `/payments` | `payment:view` | Mocked statement | ✅ |
| `/payments/pay` | `payment:pay` | Mocked payment | ✅ |
| `/payments/[id]/receipt` | `payment:pay` | Mock gateway checkout | ✅ |
| `/support` | `support:view` | Mocked support (in-memory) | ✅ |
| `/support/new` | `support:create` | Mocked support | ✅ |
| `/support/[id]` | `support:view` | Mocked support | ✅ |
| `/account` | `account:view` | Mocked loyalty/credit | ✅ |
| `/account/loyalty` | `account:view` | Mocked loyalty | ✅ |
| `/account/credit/request` | `credit:request` | Mocked credit requests | ✅ |
| `/reports` | `report:view` | Mocked reporting | ✅ |
| `/reports/ar` | `report:view` | Mocked reporting | ✅ |

### Tenant back office (`(admin)`) — gated on `admin:view`

| Route | Permission | Status |
| --- | --- | --- |
| `/admin` | `admin:view` | ✅ |
| `/admin/onboarding` | `onboarding:review` (404 otherwise — source behaviour) | ✅ |
| `/admin/onboarding/[id]` | `onboarding:review` | ✅ |
| `/admin/quotations` | `admin:view` (source has no finer guard) | ✅ |
| `/admin/credit` | `credit:decide-limit` | ✅ |
| `/admin/tickets` | `admin:view` (source has no finer guard) | ✅ |
| `/admin/tickets/[id]` | `support:resolve` | ✅ |
| `/admin/customers` | `customer:register` (404 otherwise — source behaviour) | ✅ |
| `/admin/customers/new` | `customer:register` | ✅ |
| `/admin/customers/[kunnr]` | `customer:register` | ✅ |
| `/admin/ap` | `finance:ap` | ✅ |
| `/admin/ar` | `finance:ar` | ✅ |
| `/admin/exceptions` | `exceptions:view` | ✅ |

### Platform console (`(console)`, was `apps/ops`) — gated on `platform:operate`

| Route | Permission | Status |
| --- | --- | --- |
| `/tenants` | `platform:tenant-crud` | ✅ |
| `/tenants/new` | `platform:tenant-crud` | ✅ |
| `/tenants/[id]` | `platform:tenant-crud` | ✅ |
| `/sap/config` | `platform:sap-config` | ✅ |
| `/sap/config/[id]` | `platform:sap-config` | ✅ |
| `/sap/health` | `platform:sap-health` | ✅ |
| `/operators` | `platform:operators-manage` | ✅ |
| `/billing` | `platform:billing` | ✅ |

#### Two route collisions resolved by the merge

`apps/ops` was a separate deployment on its own host, so two of its routes
collided with `apps/web`'s when both apps moved into one Next app:

| Collision | Resolution |
| --- | --- |
| `apps/ops` `/` (redirected to the operator's first visible tab) | Removed as a page. Its logic moved into `app/(portal)/layout.tsx`: a platform-plane session hitting `/` is redirected to the first visible `OPS_NAV` item. Behaviour is identical. |
| `apps/ops` `/403` (console-worded) | Removed; the shared `app/403/page.tsx` serves both planes. Copy differs slightly from the console's original. |

`apps/ops` `/login` was also dropped: both planes now share one demo login,
which routes by plane after sign-in.

---

## 3. Roles and permissions

**Unchanged from `/client`.** `packages/domain/auth.ts` came across verbatim:
6 role identifiers across 3 planes, 40 permissions, composed permission
groups. No role was invented, renamed or re-scoped.

| Role | Plane | Demo account |
| --- | --- | --- |
| `customer` | Customer | `buyer@acme-industrial.example` |
| `client_admin` | Tenant back office | `admin@acme-industrial.example` |
| `ap_manager` | Tenant back office | `ap@acme-industrial.example` |
| `ar_manager` | Tenant back office | `ar@acme-industrial.example` |
| `super_admin` | Platform | `ops@customerconnect.example` |
| `sap_manager` | Platform | `sap@customerconnect.example` |

Enforcement is still layered exactly as it was:

1. `proxy.ts` (was `middleware.ts`) — coarse gate: unauthenticated → `/login`,
   `/admin/*` needs `admin:view`, console routes need `platform:operate`.
2. Each layout — plane redirect + permission redirect on server render.
3. Each page — its own `hasPermission` check, `redirect("/403")` or
   `notFound()` as the source chose.
4. `lib/demo-api.ts` — every mutation re-checks the same permission the real
   route handler checked.

### Verified RBAC matrix (7 sessions × 52 routes = 364 requests)

```
route                        anon customer client_ad ap_mgr ar_mgr super_ad sap_mgr
/                            log  ok       →/admin   →admin →admin →console →console
/catalogue … /reports/ar     log  ok       →/admin   →admin →admin →console →console
/admin                       log  403      ok        ok     ok     403      403
/admin/onboarding            log  403      ok        404    404    403      403
/admin/credit                log  403      ok        403    403    403      403
/admin/customers*            log  403      ok        404    404    403      403
/admin/ap                    log  403      ok        ok     403    403      403
/admin/ar                    log  403      ok        403    ok     403      403
/admin/exceptions            log  403      ok        ok     403    403      403
/tenants*, /operators, /billing  log 403   403       403    403    ok       403
/sap/config*, /sap/health    log  403      403       403    403    ok       ok
```

`sap_manager` sees exactly SAP Config + SAP Health, as doc 09 §3.3 specifies —
with no code saying so, because the nav registry and permission table do it.

---

## 4. What replaced the backend

### The SAP mock came across, and it is the reason the demo is not hollow

`client/packages/adapters/sap/src/{contract,errors,mock/*}` depends on nothing
but `@cc/domain` — no Prisma, no HTTP, no env. It was migrated to
`packages/sap-mock/` and gives `/frontend` a **realistic, self-consistent,
1,448-line seeded landscape**: 3 customers in different states (so intra-state
CGST+SGST and inter-state IGST both occur), material master with pricing
conditions, an order on credit hold, a part-delivered order, open and overdue
AR items, rebate agreements.

It is a *simulator*, not static fixtures: `createSalesOrder` runs a credit
check and really can hold an order; `simulateOrder` runs ATP; `createInquiry`
auto-quotes after a delay; `postIncomingPayment` clears FI items idempotently.

### The 17 service packages → 16 frontend-only stand-ins

`packages/services/*.ts`, aliased in `tsconfig.json` under the original
`@cc/service-*` specifiers — **which is why 100+ migrated pages kept their
import lines completely untouched**.

| Mock | Reads from | Writes to |
| --- | --- | --- |
| `sap` | mock adapter | — |
| `catalogue`, `order`, `delivery`, `inquiry`, `invoice`, `loyalty`, `reporting`, `payment` | seeded SAP landscape, derived with the **domain's own** helpers | mock SAP + in-memory store |
| `support`, `notification`, `onboarding`, `customer`, `reconciliation` | in-memory store (portal-owned data) | in-memory store |
| `identity`, `platform` | fixed demo accounts / seeded tenants | in-memory store |

Two rules were kept throughout, so the swap back is mechanical:

1. Function names, parameter order and return shapes match the real service.
2. Derivations use `@cc/domain` (`salesKpis`, `buildAging`, `invoiceTax`,
   `slaView`, `quotationValidity`, `buildO2CTimeline`, …) rather than being
   recomputed — so no screen can disagree with another.

### The 76 API route handlers → one server-action router

`lib/demo-api.ts` is a **Server Action**, not an HTTP endpoint: no route is
published, and it runs on the server so it shares the in-memory store with the
pages that render. `lib/demo-fetch.ts` wraps it in a real `Response`, so each
client component's change was one line:

```diff
-const response = await fetch("/api/orders", { method: "POST", … });
+const response = await demoFetch("/api/orders", { method: "POST", … });
```

52 call sites across 32 components. Original URLs, methods, bodies, error
handling, loading states and toasts are otherwise **unchanged**.

### Backend-dependent features and their temporary behaviour

| Feature | Backend dependency | Temporary behaviour |
| --- | --- | --- |
| Login | `POST /api/auth/login`, scrypt, HS256 | Demo account picker; cookie; toast "Logged in using demo mode." |
| Logout | session invalidation | Clears cookies, redirects to `/login` |
| Account switcher | token re-issue | Cookie; still checked against `availableKunnrs` |
| Invoice PDF | SAP GOS archive | 503 + "not available in demo mode. Backend integration pending." |
| POD signature upload | object storage | Metadata recorded, no bytes stored |
| Onboarding documents | object storage | Metadata recorded, no bytes stored |
| Ticket attachments | object storage | Metadata recorded, no bytes stored |
| GSTIN verification | GSTN adapter | Deterministic format check, both branches reachable |
| Payment checkout | Razorpay + webhook | Mock gateway → in-app receipt screen → posts to mock SAP |
| Credit limit write-back | SAP KNKK | Decision recorded; seeded credit master unchanged |
| Outbox exception tray | outbox table + workers | Empty state (nothing in the frontend writes outbox rows) |
| Dashboard open-ticket KPI | ticket table | `null` → renders the source's "arrives in a later phase" subline |
| Tenant SAP credentials | encrypted vault (ADR-042) | Driver choice kept; parameters discarded, never stored |
| Email / notification fan-out | workers + email adapter | No-op; bell inbox seeded with 3 representative rows |
| Report cache | Redis | Always `live`; refresh control still works |
| Rate limiting, tracing, Sentry | observability | Removed |

### `TODO(BACKEND)` markers

**86 markers across 58 files**, all in the standard format. Densest:
`packages/services/platform.ts` (7), `support.ts` (4), `identity.ts` (4),
`reporting.ts`/`payment.ts`/`onboarding.ts`/`notification.ts`/`loyalty.ts`/
`delivery.ts` (3 each). Every migrated client component that calls `demoFetch`
carries one.

---

## 5. Design system

Tailwind was pinned back to **v3** so the shared preset works unchanged.
`packages/config/tailwind-preset.ts`, `packages/ui/tokens.css` and
`packages/ui/globals.css` are byte-for-byte the source's, so all ~40 design
tokens, both themes, the module accent colours, the radius/shadow/motion
scales and every utility class in 19k lines of migrated markup mean exactly
what they meant before. **No component was redesigned.**

Fonts (`Inter`, `JetBrains_Mono` via `next/font`), the 52px top bar, the
222px→52px collapsing sidebar, the 1440px content column and the responsive
breakpoints are all as migrated.

---

## 6. What was added (and why)

Only three things exist here that did not exist in `/client`:

| Addition | Reason |
| --- | --- |
| `components/Toast.tsx` | `/client`'s writes reached a real backend; mocked writes must still report themselves. Built from the same design tokens, not a library. |
| `components/RoleSwitcher.tsx` | Check all six roles without signing in and out. **Bypasses nothing** — it re-signs-in and every guard re-applies. |
| Demo account picker on `/login` | The entry point to the above. |

---

## 7. Dependencies

**Added** (all present in `/client` for the same reason): `@radix-ui/react-slot`,
`@radix-ui/react-tooltip`, `@tanstack/react-table`, `class-variance-authority`,
`clsx`, `lucide-react`, `recharts`, `tailwind-merge`, `zod`; dev: `tailwindcss@3`,
`postcss`, `autoprefixer`, `tsx`.

**Deliberately excluded**: `@prisma/client`, `prisma`, `pg`, `ioredis`,
`express`, `bullmq`, `pino`, `@opentelemetry/*`, `@sentry/node`, `jose`,
`argon2`/`scrypt` helpers, `razorpay`, storage SDKs, `node-rfc`.

**No environment variables are required.** No `DATABASE_URL`, `AUTH_SECRET`,
`REDIS_URL`, `CREDENTIAL_MASTER_KEY` or any other secret was copied over;
`/frontend` has no `.env` file and needs none.

---

## 8. Known limitations

1. **In-memory state.** Everything the portal owns (cart, tickets, drafts,
   credit requests, applications, payments) lives in the server process and
   resets on restart. SAP-side data resets with it.
2. **Single tenant.** Host-based tenant resolution and the cross-tenant 404
   rewrite are stubbed; `DEMO_TENANT` is always returned.
3. **`/admin/quotations` and `/admin/tickets` are reachable by `ap_manager`
   and `ar_manager`.** This is **not** a migration defect — the source pages
   carry no permission guard beyond the session either. Preserved as-is;
   worth raising against `/client`.
4. **Frozen clock.** The seeded landscape is anchored at `2026-07-26`, so
   `DEMO_TODAY` is pinned to it — otherwise every seeded invoice would read as
   years overdue.
5. **Lint: 8 warnings, 0 errors.** Six are `react-hooks/set-state-in-effect`
   and one `react-hooks/purity` in components migrated verbatim, under rules
   `eslint-config-next` 16 added and `/client` (on 15) never applied. Scoped
   to warnings in `eslint.config.mjs` with a `TODO(FOLLOW-UP)` listing each
   site, rather than refactoring working UI during a migration.
6. **`middleware.ts` → `proxy.ts`.** Next 16 renamed the convention; the file
   was renamed and the export follows. Behaviour unchanged.
7. **No E2E suite.** `client/apps/web/e2e/*.spec.ts` (13 Playwright specs) was
   not migrated — it asserts against real backend state. `scripts/demo-smoke.ts`
   covers the same flows against the mock layer instead.

---

## 9. How to run

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Sign in at `/login` with any of the six demo accounts (any password), or use
the picker. The floating **Demo role** control switches personas.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # next build
npm run smoke        # write-path checks against the mock services
```
