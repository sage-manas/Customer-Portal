# 12 — Claude Code Prompt: Completeness Programme

## Paste everything below the line into Claude Code in this repo.

---

Close the gaps identified in `docs/11-COMPLETENESS-GAP-ANALYSIS.md`. This is a mature codebase — read before you write, and never rebuild what exists.

## Orient first

1. `CLAUDE.md` — every rule binds. In particular: registries not duplication, ADR-016 (SAP owns the document; store only what SAP cannot hold), `runWithTenant` on every query, cross-tenant/customer = 404, permissions via registry with `requirePermission` at the handler, and the `API_ROUTES` declaration that the route×role matrix test regenerates from.
2. `docs/11-COMPLETENESS-GAP-ANALYSIS.md` — the authority for _what_ is missing and in what order (§3 prioritised backlog).
3. `docs/09-RBAC-RESTRUCTURE-PLAN.md` — the six-identifier role model you are extending, never widening casually.
4. `docs/DECISIONS.md` — respect existing ADRs; every new judgement call gets a new one.

Reference implementations to imitate: `@cc/service-order`/`@cc/service-invoice` (SAP-owned, store nothing), `@cc/service-payment` (portal-owned + webhook + idempotency), `@cc/service-support` (portal-owned document with a transition registry), `@cc/service-notification` (registry-driven, silence-by-default).

## Phases — strictly sequential. Each closes with green `turbo run typecheck lint test build`, the relevant `test:integration` suites, a Playwright spec, updated package README, and ADRs recorded.

### Phase P0-1 — Shell integrity & tenant settings

Build `/admin/settings` (`tenant:settings`): branding (logo, primary colour with a contrast check), module toggles (the `moduleToggles` that `visibleNavItems` already reads), notification policy, financial-year config, SLA overrides, loyalty threshold overrides, default payment terms. All settings are a **registry of setting definitions in `@cc/domain`** (key, type, scope, default, validation) rendered generically — not a hand-built form. Add a test asserting **every `NAV_ITEMS` href resolves to a real route** in both apps, so a dead tab can never ship again.

### Phase P0-2 — Identity hardening

Password reset (token, expiry, single-use, rate-limited), account lockout + login throttle, CSRF protection on every cookie-authenticated mutating route (double-submit or origin check — pick one, ADR it, apply globally in middleware not per handler), security headers (CSP, HSTS, frame-ancestors), session revocation (logout-everywhere; force-invalidate on role change), password policy for the credentials issued by back-office registration. Add auth-specific rate limits distinct from general middleware limits.

### Phase P0-3 — MFA

TOTP enrolment/verify/recovery codes. **Mandatory for the ops plane** (`super_admin`, `sap_manager`), optional-per-tenant-policy for `client_admin`/`ap_manager`/`ar_manager`, optional for `customer`. Policy lives in the settings registry from P0-1.

### Phase P0-4 — User management, both planes

`/admin/users` (`account:manage-users` on the tenant side, or a new `tenant:users-manage` — decide and ADR): invite tenant staff, assign one of `client_admin|ap_manager|ar_manager`, disable, resend invite, force password reset. `/account/users` (customer plane): the buyer's own users scoped to their KUNNR links, invite/disable, no role widening beyond `customer`. Both reuse one invitation service; roles come from the registry, never a literal list in the UI.

### Phase P0-5 — Event & notification completeness

Add to `DOMAIN_EVENTS` and the notification template registry, each written in the transaction that makes it true: `order.confirmed`, `order.credit-blocked`, `order.cancelled`, `delivery.dispatched`, `invoice.created`, `invoice.overdue` (swept, like `support.sla.breached`), `payment.failed`, `onboarding.approved`, `onboarding.rejected`, `customer.deactivated`, plus a template for the existing `delivery.discrepancy.reported`. Recipient resolution uses the existing `resolveRecipients` rules — a customer template with no KUNNR resolves to nobody.

### Phase P1-1 — India compliance generation

New `@cc/adapter-einvoice` and `@cc/adapter-eway`: contract + **mock driver first**, GSP driver skeleton behind it (like ecc/s4). Generate IRN at billing (QR payload, cancel window, dedupe key), e-way bill at PGI (part-A/part-B, validity/distance rules, cancel/extend). Failures land in a dedicated exception queue (reuse the AP exceptions pattern) — a compliance failure must never silently pass. Surface via the existing `ComplianceBadge`; add PDF/QR rendering.

### Phase P1-2 — AR depth

Dunning (overdue ladder as a **registry** of stages → days-overdue → channel → template; swept by a worker like SLA breach), promise-to-pay tracking, manual/offline payment recording (NEFT received outside the gateway) with the same idempotency discipline as ADR-021, payment allocation UI across open items, collections dashboard (DSO trend, aging by customer, at-risk list, collector worklist), scheduled statement dispatch, write-off with approval, late-fee rules in the settings registry.

### Phase P1-3 — AP depth: disputes, credit notes, returns

Invoice dispute becomes a first-class state (customer raises → AP evaluates → resolve or issue G2/L2 in SAP via a new adapter method, mock first). Full returns/RMA loop: return request → approval → return delivery → credit note, with its own status registry in `@cc/domain`. Refund lifecycle: approval thresholds, gateway refund execution, partials, failure handling. Settlement-file ingestion and three-way matching (payout ↔ bank ↔ SAP clearing). AP home dashboard.

### Phase P1-4 — Customer plane completeness

`/account/profile` (company master, read-mostly from SAP with freshness), `/account/addresses` (ship-to management), notification preferences. Reorder / order templates / scheduled orders. Order change request post-submission (per doc 05 §7.4). Document downloads: order confirmation, delivery challan, e-way bill, consolidated statement. Saved carts, CSV quick-order pad, favourites. Saved filters and bulk export on every list.

### Phase P1-5 — Back-office read-across

Admin registers for orders, deliveries and invoices across all customers (filters, export) and a **customer 360** (orders, invoices, open items, tickets, credit position, loyalty in one view). These are permission-scoped compositions of existing services — no new business logic. Add tenant audit-trail and customer-user admin (resend credentials, unlock).

### Phase P2-1 — sap_manager depth

Connection diagnostics (latency percentiles, error taxonomy, last-N failed calls with request/response, retry), **per-tenant SAP field-mapping overrides** (override rows against the global registry — absent row = registry default, exactly like the loyalty ladder pattern), sandbox vs production config per tenant with a promotion flow and dry-run, an adapter **contract conformance suite** runnable against a tenant's SAP producing a per-method pass/fail report, ops-side outbox/replay tools, credential rotation with expiry warnings, per-tenant SAP rate/quota config.

### Phase P2-2 — super_admin depth

Tenant lifecycle (suspend vs terminate, offboarding data export, clone-from-template, trial→paid), **impersonation with mandatory reason + immutable audit + time limit + visible banner**, cross-tenant audit explorer over `AuditLog`/`SapConfigAudit`, platform health (queue depth, worker liveness, outbox backlog, error rates, per-tenant volume), module/feature-flag toggle UI, metering → billing (usage counters, plan limits, overage, tenant invoicing behind the existing billing adapter), tenant announcements/maintenance banners.

### Phase P2-3 — Quality bar

`axe` accessibility assertions in CI on every core screen (violations fail the build), the mobile shell from doc 05 §5 (bottom tabs, stacked-card tables), ⌘K command palette over documents and materials, i18n scaffolding (extract strings; en-IN default; one additional locale proving the pipeline), WhatsApp + SMS notification drivers behind the existing interface with per-tenant channel policy and quiet hours, k6 load tests on catalogue/order/payment, bundle budgets, N+1 query guard, runbooks + DR restore drill + status page, public API versioning and tenant-facing webhooks.

## How to work

- One phase at a time. Before each: post a short plan (packages touched, registries extended, new tables, routes, permissions). After each: full pipeline + integration suites, README, ADRs, Conventional-Commit-sized commits.
- **Registry test:** if you are about to write a list of statuses, stages, settings, templates, dunning steps or permissions inline, stop and put it in `@cc/domain`.
- **Storage test:** if SAP can hold it, do not store it (ADR-016). If SAP cannot, store the minimum and say why in an ADR.
- Every new tenant-owned model: `tenantId` + `TENANT_SCOPED_MODELS` + an isolation-test case. Every new route: declared in `API_ROUTES` with its permission, or CI fails.
- Every new external system: interface + mock driver first; real driver behind the same contract, never in app code.
- Ambiguity: pick the registry-driven / tenant-safe / mock-first option, record an ADR (newest first), keep moving.

Start with Phase P0-1: read `packages/domain/src/navigation.ts` and the settings-related code paths (`moduleToggles`, loyalty overrides, SLA registry) first, then post your plan.
