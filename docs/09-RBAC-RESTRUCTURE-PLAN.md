# 09 — RBAC Restructure Plan: The Five-Tier Role Model

Version 1.0 · 2026-07-26 · Companion to docs 00–08. Supersedes the 8-role model in `packages/domain/src/auth.ts` (docs/02 §3).

---

## 1. Target role model

Five tiers, six role identifiers, across the existing three planes. (AP and AR sit on the same tier — hence "five roles" in product language, six identifiers in code.)

| Tier | Role id        | Plane    | App                   | Who                                                                                                                                                                                                                                |
| ---- | -------------- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `super_admin`  | Platform | `apps/ops`            | You. God access: tenant CRUD, SAP config/edit/health per tenant, everything the platform can do.                                                                                                                                   |
| 2    | `sap_manager`  | Platform | `apps/ops`            | Under super admin. Manages SAP connections of **all** tenants: configure, edit, test, monitor health. No tenant CRUD, no billing, no operator-user management.                                                                     |
| 3    | `client_admin` | Tenant   | `apps/web` `/admin/*` | The tenant's admin. Register/edit/delete/deactivate customers from the dashboard, full finance visibility, plus everything today's tenant back-office does (onboarding approval, quotations, credit decisions, support, settings). |
| 4    | `ap_manager`   | Tenant   | `apps/web` `/admin/*` | Accounts Payable: outgoing-money documents — credit notes, refunds, rebate settlements, payment-gateway reconciliation/exceptions.                                                                                                 |
| 4    | `ar_manager`   | Tenant   | `apps/web` `/admin/*` | Accounts Receivable: incoming money — invoices, statements, open items, AR aging, incoming payments, dunning view, credit release.                                                                                                 |
| 5    | `customer`     | Customer | `apps/web` portal     | The buyer. One consolidated role replacing `buyer_admin`/`buyer_user`/`buyer_view_only`.                                                                                                                                           |

### Principles carried over (do not renegotiate)

- **Registry, never `if (role === …)`** — roles map to permissions in one place; all code asks `hasPermission(session, "…")`. This is CLAUDE.md rule 5 and stays.
- **Nav visibility = permission-driven** — `visibleNavItems` already filters by permission; users see only tabs they can use. The API remains the enforcement point (`requirePermission`); hiding a tab is presentation.
- **Plane separation** — platform roles get zero tenant-data permissions; ops and web stay separate apps with separate sessions. `super_admin`/`sap_manager` never appear in a web-app JWT.
- **404 not 403** for cross-tenant / cross-customer; 403 only for "you exist here but lack the permission".

## 2. Permission matrix (the new `ROLE_PERMISSIONS`)

New permissions to add to the registry: `platform:tenant-crud`, `platform:sap-config`, `platform:sap-health`, `platform:operators-manage`, `platform:billing`, `customer:register`, `customer:edit`, `customer:deactivate`, `finance:ap`, `finance:ar`.

| Capability (permission)                                                                                 | super_admin | sap_manager | client_admin | ap_manager | ar_manager            | customer |
| ------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ------------ | ---------- | --------------------- | -------- |
| Tenant CRUD (`platform:tenant-crud`)                                                                    | ✅          | —           | —            | —          | —                     | —        |
| Operator user mgmt, billing                                                                             | ✅          | —           | —            | —          | —                     | —        |
| SAP config/edit per tenant (`platform:sap-config`)                                                      | ✅          | ✅          | —            | —          | —                     | —        |
| SAP health/monitoring (`platform:sap-health`)                                                           | ✅          | ✅          | —            | —          | —                     | —        |
| Admin shell (`admin:view`)                                                                              | —           | —           | ✅           | ✅         | ✅                    | —        |
| Register/edit/deactivate customers (`customer:*`)                                                       | —           | —           | ✅           | —          | —                     | —        |
| Onboarding review + approve                                                                             | —           | —           | ✅           | —          | —                     | —        |
| Quotation issue, catalogue/inquiry admin views                                                          | —           | —           | ✅           | —          | —                     | —        |
| Credit release + limit decisions                                                                        | —           | —           | ✅           | —          | ✅ (`credit:release`) | —        |
| Support view/resolve                                                                                    | —           | —           | ✅           | —          | —                     | —        |
| Tenant settings                                                                                         | —           | —           | ✅           | —          | —                     | —        |
| AP: credit/debit notes, refunds, rebate settlement, gateway reconciliation, exceptions (`finance:ap`)   | —           | —           | ✅           | ✅         | —                     | —        |
| AR: invoices, statements, open items, aging, payments received, reports (`finance:ar`)                  | —           | —           | ✅           | —          | ✅                    | —        |
| Customer portal: catalogue, cart, inquiry, order, delivery/POD, invoice, pay, support, loyalty, reports | —           | —           | —            | —          | —                     | ✅       |

`client_admin` = union of all tenant-plane permissions (compose in code: `[...AP, ...AR, ...TENANT_OPS]`, not hand-listed). Exact leaf permissions reuse today's registry; only groupings change.

## 3. Changes by layer

### 3.1 `@cc/domain` (auth + navigation registries) — the heart of the change

- Replace `ROLES` with the six identifiers; keep the `Role`/`Permission` type machinery, `hasPermission`, `rolesWithPermission`, `permissionsForRoles` untouched.
- Rebuild `ROLE_PERMISSIONS` per §2, composing `client_admin` from the AP/AR/ops permission groups.
- Update plane helpers: `isPlatformRole`, `isBackOfficeRole` (now `client_admin|ap_manager|ar_manager`), `isCustomerRole`.
- Navigation registry: add nav items for the new admin tabs (Customers, AP workspace, AR workspace, SAP health in ops) each declaring its required permission; `visibleNavItems` needs no logic change — that's the payoff of the registry design.
- **Legacy-role mapping table** (exported, used by migration + any lingering data): `buyer_* → customer`, `tenant_admin → client_admin`, `tenant_credit → ar_manager`, `tenant_sales|tenant_support → client_admin` (flag for manual re-assignment), `platform_operator → super_admin`.

### 3.2 `@cc/db` — data + migration

- Prisma migration: no schema change if roles are stored as strings/enums in the users table — a data migration maps legacy → new via the table in §3.1. If a Prisma enum exists, widen first, backfill, then narrow (expand–migrate–contract).
- Ops-plane users table gains `role: super_admin | sap_manager` (today it's implicitly single-role operator).
- Notification recipient resolution (`roles hasSome […]` per ADR) re-derives from `rolesWithPermission` — verify A7 queries still resolve after the collapse.
- Seed script updated: one user of each of the six roles for dev.

### 3.3 `apps/ops` — super admin + SAP manager console

- Operator auth gains roles; `requirePermission` middleware mirrors the web app's.
- **Super admin only:** tenant create/edit/delete (soft-delete/deactivate with confirmation naming consequences), operator-user management, billing stub.
- **Both roles:** per-tenant SAP configuration screen (driver ecc/s4/mock, connection params, credentials via the B1 envelope-encryption store, "Test connection" action), SAP health dashboard (per-tenant: connectivity, last successful call, error rate, queue depth — reuse B5 health read-model), config audit trail (who changed what, when — append-only).
- Nav filtered by `visibleNavItems` with ops nav registry: `sap_manager` sees only SAP Config + SAP Health.

### 3.4 `apps/web` — tenant back-office + customer portal

- **New: Customer management tab** (`/admin/customers`, `customer:*` perms — client_admin only):
  - List (DataTable: name, KUNNR, GSTIN, status, tier), detail, edit, deactivate (deactivation blocks login + new orders, never deletes O2C history — record ADR).
  - **Register Customer** (the requested tenant-side registration): reuses the existing 4-step onboarding wizard (`ONBOARDING_STEPS` registry — same fields, zero duplication) in back-office mode: client_admin fills it on the customer's behalf; submission lands in the same approval pipeline but is **pre-approved by construction** (self-approval collapses review; still creates the SAP customer master via the same service path and issues credentials to the customer's email). One service, two entry points — mirror the customer-plane/desk-plane file separation pattern (ADR-032 style).
- **AP workspace** (`/admin/ap`): credit/debit notes list, refunds queue, rebate settlements, gateway reconciliation + exceptions tray (move `/admin/exceptions` here).
- **AR workspace** (`/admin/ar`): invoice register, statements, open items + aging, payments received, credit release queue (moves from credit role), dunning-candidates view.
- Existing admin routes re-tagged with new permissions; the customer portal collapses buyer-role variance (view-only rendering paths removed or kept behind a per-user flag — decide, ADR it).
- Public self-registration (`/register`) unchanged.

### 3.5 Services

- No business-logic changes; only `requirePermission` guards and recipient resolution touchpoints. `@cc/service-onboarding` gains the back-office-initiated entry point (thin: same core flow, skips the review gate, records `initiatedBy`).

## 4. Migration & rollout plan

1. Domain registry change behind a single commit (types will surface every affected callsite at compile time — the strict TS payoff).
2. Data migration with legacy-mapping table; ambiguous users (`tenant_sales`, `tenant_support`) mapped to `client_admin` and listed in the migration output for manual review.
3. Session invalidation: bump JWT claim version so stale role claims force re-login.
4. Isolation/authz test sweep updated: the route×role matrix test regenerates from `rolesWithPermission` — every route asserts allowed roles pass and all others 403/404.
5. Seed + Playwright fixtures updated to the six roles; one E2E per tier proving nav shows exactly the permitted tabs.

## 5. Acceptance criteria

- Exactly six role identifiers exist in code; zero `role ===` comparisons outside the registry (grep-enforced lint rule).
- Each role's nav shows only permitted tabs (Playwright asserts per role); API returns 403/404 for everything else regardless of UI.
- Client admin can register a customer end-to-end from `/admin/customers/new` → customer receives credentials → can log in and order — on mocks.
- SAP manager can edit a tenant's SAP config and see health, but cannot see tenants list CRUD actions or billing.
- Legacy users migrated with an auditable mapping report; no orphaned notification subscriptions.
