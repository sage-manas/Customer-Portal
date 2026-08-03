# 10 — Claude Code Prompt: Five-Tier RBAC Restructure

## Paste everything below the line into Claude Code in this repo.

---

Implement the five-tier role model specified in `docs/09-RBAC-RESTRUCTURE-PLAN.md` in this repo. This is a restructure of a working system — read before you write.

## Orient first

1. `CLAUDE.md` — all rules bind, especially rule 5 (permissions are a registry; never `if (role === …)`; API is the enforcement point; cross-tenant/customer = 404).
2. `docs/09-RBAC-RESTRUCTURE-PLAN.md` — the authority for this work: target roles, permission matrix, per-layer changes, migration, acceptance criteria.
3. `packages/domain/src/auth.ts` and `navigation.ts` — the registries you are reshaping. Understand `ROLE_PERMISSIONS`, `hasPermission`, `rolesWithPermission`, `visibleNavItems` before changing anything.
4. `docs/DECISIONS.md` — respect existing ADRs; this work adds new ones (role collapse, deactivation semantics, back-office registration, ops roles).

Target model (six identifiers, five tiers): platform `super_admin`, `sap_manager` (apps/ops) · tenant `client_admin`, `ap_manager`, `ar_manager` (apps/web /admin) · `customer` (portal). Permission matrix is doc 09 §2 — follow it exactly; compose `client_admin` from the AP/AR/ops permission groups, never hand-list.

## Phases (strictly sequential; each ends with green `turbo run typecheck lint test build` + relevant integration suites + ADRs + README updates before the next)

### Phase 1 — Domain registry

Replace `ROLES` with the six identifiers; rebuild `ROLE_PERMISSIONS` per doc 09 §2 (add the new permissions: `platform:tenant-crud`, `platform:sap-config`, `platform:sap-health`, `platform:operators-manage`, `platform:billing`, `customer:register|edit|deactivate`, `finance:ap`, `finance:ar`). Update plane helpers (`isPlatformRole`, `isBackOfficeRole`, `isCustomerRole`). Export the legacy→new mapping table (doc 09 §3.1). Update the navigation registry: new items (Customers, AP, AR, ops SAP Config/Health) each declaring its permission — `visibleNavItems` logic must not change. Let strict TypeScript surface every broken callsite; fix them all in this phase. Add a lint rule (or grep-based test) failing on `role ===` comparisons outside `@cc/domain`.

### Phase 2 — Data migration & sessions

Prisma data migration mapping legacy roles via the exported table (expand–migrate–contract if an enum). Ops users gain `super_admin|sap_manager` roles. Bump the JWT claim version to force re-login. Emit a migration report listing users that were `tenant_sales`/`tenant_support` (now `client_admin`, flagged for manual review). Update seeds: one dev user per role. Verify A7 notification recipient resolution (`rolesWithPermission`-derived queries) still resolves correctly — add a regression test.

### Phase 3 — Route guard sweep + authz matrix test

Re-tag every route handler in `apps/web` and `apps/ops` with the new permissions. Build the generated route×role matrix test: for each route, roles from `rolesWithPermission(requiredPermission)` must pass; all other roles must get 403 (same tenant) or 404 (cross-tenant/KUNNR). This test regenerates from the registry — adding a route without declaring its permission must fail CI.

### Phase 4 — Ops console: super admin + SAP manager

In `apps/ops`: role-aware auth + `requirePermission` middleware mirroring the web app; nav via an ops navigation registry. Super-admin-only: tenant CRUD (deactivate = soft, confirmation dialog naming consequences), operator-user management, billing stub. Both roles: per-tenant SAP configuration screen (driver selection, connection params, credentials through the existing envelope-encryption store, Test Connection action against the adapter factory), SAP health dashboard (reuse the B5 health read-model), append-only config audit trail. `sap_manager` must see only SAP Config + SAP Health tabs.

### Phase 5 — Tenant customer management + back-office registration

`/admin/customers` (client_admin only): list/detail/edit/deactivate (deactivation blocks login + new orders, never deletes O2C history — ADR). **Register Customer** at `/admin/customers/new`: reuse the `ONBOARDING_STEPS` registry and the existing onboarding service via a new back-office entry point (separate service file, ADR-032 pattern) — same validation, same SAP customer-master creation, skips the review gate (initiator is the approver), records `initiatedBy`, emails credentials to the customer. Zero field duplication: if you find yourself copying a field list, stop and use the registry.

### Phase 6 — AP / AR workspaces

`/admin/ap` (`finance:ap`): credit/debit notes, refunds queue, rebate settlements, gateway reconciliation + move the exceptions tray here. `/admin/ar` (`finance:ar`): invoice register, statements, open items + aging (`AmountAging`), payments received, credit release queue (relocated), dunning-candidates view. Reuse existing services/components — these are permission-scoped compositions, not new business logic.

### Phase 7 — Portal role collapse + E2E

Collapse buyer-role variance in the customer portal to the single `customer` role (decide whether a per-user view-only flag survives; ADR either way). Playwright: one spec per role asserting (a) nav shows exactly the permitted tabs, (b) a representative forbidden route 403/404s, (c) the client_admin registration flow end-to-end → new customer logs in and places a mock order.

## How to work

- Post a short plan before each phase (files, registry changes, new routes/tables). Conventional-Commit-sized commits.
- Every new tenant-owned model: `tenantId` + `TENANT_SCOPED_MODELS` + isolation-test case.
- Every ambiguity: choose the registry-driven / tenant-safe option, record an ADR (newest first), keep moving — don't stall.
- Doc 09 §5 acceptance criteria are the definition of done for the whole effort; verify each explicitly at the end and report.

Start with Phase 1: read `auth.ts` + `navigation.ts` fully, then post your plan.
