# 08 — Claude Code Continuation Prompt

## Paste everything below the line into a fresh Claude Code session in this repo.

---

Continue building **CustomerConnect Portal** in this repo. This is a continuation, not a kickoff — a large working codebase exists. Do not scaffold anything that already exists.

## Orient first (before any code)

1. Read `CLAUDE.md` — the load-bearing rules. All of them still bind.
2. Read `docs/07-NEXT-PHASE-GUIDE.md` — the audited current state and the exact remaining plan (Tracks A/B/C). It is the authority for what to build next and in what order.
3. Skim `docs/DECISIONS.md` (ADR-001…021) — never re-decide something recorded there.
4. Read the README of any package before touching it; study `@cc/service-order` and `@cc/service-invoice` as the reference implementations for the ADR-016 "SAP owns it, store nothing" pattern, and `@cc/service-payment` for the portal-owned + webhook + idempotency pattern. New services must mirror these shapes.

## What is done (do not rebuild)

Phases 0–5 of docs/06: monorepo, tenancy + isolation tests, domain registries, mock adapters (SAP/GSTN/storage/payment), services (identity, sap, onboarding, catalogue, order, invoice, payment), UI package + Storybook, and all web routes for auth/register/admin-onboarding/dashboard/catalogue/orders/invoices/payments. ECC/S4 drivers are intentional `not_implemented` skeletons until Track C.

## Your work queue (strictly sequential; each item = green `turbo run typecheck lint test build` + Playwright happy path + README + ADRs before the next)

**Track A — complete the product surface on mocks:**

1. **A1 Async backbone:** tenant-scoped `outbox` table; BullMQ on the existing Redis; new `@cc/workers` package + worker entrypoint. Transactional outbox pattern: services write events in the same transaction, worker relays. Add the new allowed edge `workers -> services, adapters, db, domain, config` to `packages/config/eslint/base.js` and record it as an ADR first.
2. **A2 Delivery & POD** (`@cc/service-delivery`): extend `SapAdapter` contract (`getDeliveries`, `getDelivery`, `confirmPod`) + mock driver seed linked to existing mock orders. SAP owns deliveries — store only POD confirmations/discrepancies. KUNNR mismatch → 404. Routes `/deliveries`, `/deliveries/[vbeln]`, `/deliveries/[vbeln]/pod` per docs/05 §7.5; wire `O2CTimeline` from orders/invoices. Discrepancy emits an outbox event (consumed by A3 later).
3. **A3 Support** (`@cc/service-support`): portal-owned tickets, SLA registry in `@cc/domain` (no hand-written switches), threaded comments, attachments via storage adapter, SLA-breach events via outbox. Routes `/support/*` + `/admin/tickets`. Consume A2's discrepancy events → auto-tickets.
4. **A4 Inquiry & Quotation** (`@cc/service-inquiry`): contract additions + mock auto-quoting; only drafts stored; accept → convert-with-reference → deep-link to order. Routes per docs/05 §7.3.
5. **A5 Loyalty & Credit** (`@cc/service-loyalty`): credit position composed from adapter reads (nothing stored); tenant-configurable tier thresholds; FY-aware YTD; credit-increase requests reuse the onboarding approval pattern.
6. **A6 Reports** (`@cc/service-reporting`): read-only aggregations, Redis-cached per tenant, data-as-of surfaced via `SapSyncIndicator`. `/reports` + AR aging drill-down per docs/05 §7.10.
7. **A7 Notifications** (`@cc/adapter-notifications` + worker consumer): interface + mock driver + email driver; template registry in domain; in-app bell inbox (tenant-scoped table + top-bar UI).

**Track B — production substrate (after A1; B-items may interleave between A-items if blocked):**

8. **B1** Envelope encryption for per-tenant credentials (master key from env locally, KMS-ready interface).
9. **B2** Real Razorpay driver behind the existing `PaymentGatewayAdapter` interface — signature-verified webhook, ADR-021 idempotency untouched; per-tenant sandbox keys via B1.
10. **B3** Observability: pino with tenantId/requestId correlation, OTel spans around adapter calls, `/api/health`, per-tenant rate limiting.
11. **B4** Reconciliation worker jobs (payment↔gateway↔SAP posting; stuck outbox) + `/admin/exceptions` tray.
12. **B5** `apps/ops` operator console: separate auth realm, tenant provisioning wizard, tenant health dashboard, usage read-model; billing behind a stubbed interface.

**Track C (real SAP / GSP / pilot) is out of scope for this session** unless I provide sandbox credentials — but keep every contract shaped so C is a driver swap, never an app change.

## How to work

- One work-queue item at a time. Before each: post a short plan (packages touched, contract changes, new tables, routes). After each: run the full turbo pipeline plus the relevant `test:integration` suites, update the package README, commit in Conventional-Commit-sized pieces.
- Registry rule: any new field list, status, SLA tier, or notification template goes in a `@cc/domain` registry, never inline.
- Tenancy rule: every new Prisma model that is tenant-owned gets `tenantId`, joins `TENANT_SCOPED_MODELS`, and is covered by an added case in `test:isolation`.
- Security rule: cross-tenant and cross-KUNNR access is always 404; `requirePermission` in every new route handler; new permissions go in the `@cc/domain` auth registry with nav entries in the navigation registry.
- Ambiguity rule: pick the contract-first / tenant-safe / mock-first option, record an ADR in `docs/DECISIONS.md` (newest first), keep moving.

Start with item 1 (A1 async backbone): read the payment service's idempotency implementation first, then post your plan.
