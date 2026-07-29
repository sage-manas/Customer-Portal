# 07 — Next-Phase Implementation Guide

## From "mock-backed MVP core" to pilot-ready SaaS

Version 1.0 · 2026-07-26 · Companion to docs 00–06. Assumes the state audited on this date: Phases 0–5 of the docs/06 build order substantially complete (foundation, mock SAP adapter, auth/tenancy, onboarding, catalogue+cart, orders, invoices, payments), Phases 6–7 not started.

---

## 1. Verified current state

| Area                                                                                               | Status                                                          |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Monorepo, boundaries, CI conventions                                                               | ✅ Done (eslint-plugin-boundaries enforced)                     |
| Tenancy (runWithTenant, TENANT_SCOPED_MODELS, isolation tests)                                     | ✅ Done                                                         |
| Domain registries (sap-mapping, status, auth, navigation, validation)                              | ✅ Done                                                         |
| Mock adapters: SAP, GSTN, storage, payment gateway                                                 | ✅ Done (active backbone)                                       |
| Services: identity, sap, onboarding, catalogue, order, invoice, payment                            | ✅ Done w/ integration tests                                    |
| UI package + Storybook (SapField, DataTable, O2CTimeline, …)                                       | ✅ Done                                                         |
| Web app routes: auth, register, admin onboarding, dashboard, catalogue, orders, invoices, payments | ✅ Done                                                         |
| ECC / S4 real drivers                                                                              | ⬜ Skeletons throwing `not_implemented` (planned Phase 7)       |
| Delivery & POD (`@cc/service-delivery`)                                                            | ✅ Done (A2: tracking, POD, discrepancy events)                 |
| Support & SLA (`@cc/service-support`)                                                              | ✅ Done (A3: tickets, SLA sweep, auto-ticket from POD)          |
| Inquiry/Quotation · Loyalty · Reports                                                              | ⬜ Stubs (README only)                                          |
| adapters: einvoice, eway, notifications                                                            | ⬜ Not created                                                  |
| Queue/worker/outbox                                                                                | ✅ Done (A1: `@cc/workers`, transactional outbox, BullMQ relay) |
| Notification engine                                                                                | ⬜ Missing (A7)                                                 |
| apps/ops (operator console), tenant provisioning, billing                                          | ⬜ Stub                                                         |
| KMS/credential vault, security audit, load tests, runbooks, pilots                                 | ⬜ Not reached                                                  |

**Conclusion:** on-plan against docs/06. The remaining work splits into three tracks below. Track A completes the product surface on mocks; Track B builds the production substrate; Track C is integration + pilot. A before B before C, with B-1 (outbox/queue) pulled forward because delivery events and notifications depend on it.

---

## 2. Track A — Complete the module surface (still mock-first)

Sequenced; each phase ends with passing `turbo run typecheck lint test build` + module Playwright happy path + updated READMEs/DECISIONS.

### A1. Async backbone prerequisite (small, do first) — ✅ **Done**

- `packages/db`: `outbox` table (tenant-scoped) + Prisma model; BullMQ queues on existing Redis; a `packages/workers` package (new allowed edge: `workers -> services, adapters, db, domain, config` — record as ADR) with one worker process entry (`apps/worker` or `packages/workers/bin`).
- Pattern: services write domain events to outbox inside the same transaction; worker relays to queues. This is ADR-021-consistent (idempotency keys).
- **As built:** `OutboxEvent` model + `writeOutboxEvent` in `@cc/db`; `DOMAIN_EVENTS` registry in `@cc/domain` (event → queue → Zod payload); `@cc/workers` with the at-least-once relay, handler registry, BullMQ consumers and `src/bin/worker.ts`. Boundary edge added to `packages/config/eslint/base.js`. Recorded as ADR-022 (the layer) and ADR-023 (the outbox contract). First producer and consumer are wired end to end: `@cc/service-payment` emits `payment.captured`/`payment.posted` in the transactions that make them true, and the `payment.captured` handler retries a SAP posting that the inline attempt lost to an outage — the gap ADR-019 names and nothing previously closed.

### A2. Delivery & Tracking + POD (`@cc/service-delivery`) — ✅ **Done**

- SAP contract additions: `getDeliveries(kunnr)`, `getDelivery(vbeln)` (LIKP/LIPS + WBSTK), `confirmPod(...)` — mock driver first, seed data linked to existing mock orders.
- ADR-016 applies: SAP owns deliveries — store nothing except POD confirmations/discrepancies (portal-owned, tenant-scoped). KUNNR check → 404, same as orders/invoices.
- E-way bill number surfaces read-only from mock SAP (`ComplianceBadge`); real generation is Track C.
- POD discrepancy auto-creates a support ticket → depends on A3 interface only; until A3 lands, write the event to outbox.
- UI per docs/05 §7.5: `/deliveries`, `/deliveries/[vbeln]`, `/deliveries/[vbeln]/pod`; extend `O2CTimeline` wiring from orders/invoices.
- **As built:** contract grew `getDeliveries(kunnr)`, `getDeliveriesForOrder(vbeln)` (the old order-keyed `getDeliveries`), `getDelivery(vbeln)` and `confirmPod` (VLPOD); `Delivery` grew `kunnr` (LIKP-KUNAG) so the ownership check is a field comparison rather than a second SAP read that could fail open — ADR-025. `@cc/service-delivery` stores only the POD _evidence_ (`PodConfirmation` + lines, tenant-scoped, one per delivery), posting the receipt to SAP first and writing the row plus its outbox event in one transaction — ADR-026. `delivery.discrepancy.reported` gained the payload A3 needs (sales order, per-line differences, notes) and `delivery.receipt.confirmed` joined the registry; neither has a handler yet, which is the legitimate no-op ADR-023 describes. Domain gained `entities/delivery.ts` (stage registry, `podDiscrepancy`, `isPodConfirmable`, `podConfirmSchema`) and `mapDeliveryWbstkToStatus`; UI gained `DeliveryTracker`. Signed-POD scans go to `@cc/adapter-storage` before the receipt is submitted, so an upload failure can't strand a customer SAP has already accepted.

### A3. Service & Support (`@cc/service-support`) — ✅ **Done**

- Portal-owned tickets (tenant + KUNNR scoped, Prisma), category/priority/SLA registry in `@cc/domain` (SLA hours per priority — registry, not switch statements).
- SLA timers computed, breach events via outbox. Threaded comments, attachments via `@cc/adapter-storage`.
- Routes `/support`, `/support/new`, `/support/[id]` + admin ticket workbench `/admin/tickets` (SLA-sorted).
- **As built:** `entities/support.ts` in `@cc/domain` holds every rule a ticket obeys — category → routed role, priority → SLA hours, the transition table (which carries _who_ may make each move, so a customer cannot resolve their own ticket), the 7-day reopen window and the status timeline. The portal owns the whole document, which is not a break with ADR-016 but a case outside it — SAP owns nothing here while a tenant runs portal-native (ADR-028). Internal notes are excluded from a customer read **in the query**, and the customer and back-office planes are separate service files rather than one function with a visibility flag. `support.ticket.created` / `.resolved` are written in the transactions that make them true; `support.sla.breached` cannot be, because a deadline passing with nothing happening is not a transaction — it is swept by a loop in `@cc/workers` that writes to the outbox like any producer (ADR-029). A2's `delivery.discrepancy.reported` finally has its consumer: `handlers/support-auto-ticket.ts` raises the Delivery-category ticket through the same `insertTicket` the customer's form uses, idempotent on a unique `sourceKey`. UI gained `SlaChip`, `TicketTimeline` and `CommentThread`; nav flipped `support` and `admin-tickets` to live.

### A4. Inquiry & Quotation (`@cc/service-inquiry`)

- SAP contract: `createInquiry`, `getQuotations(kunnr)`, `getQuotation(vbeln)`, `convertQuoteToOrder` (mock: sales-side auto-quotes after a delay to make the flow demoable).
- SAP owns both documents (ADR-16 pattern); only portal drafts stored. Accept → convert with reference → deep-link to created order.
- Routes per docs/05 §7.3. Admin quotation workbench can be minimal (list + issue-quote form against mock).

### A5. Loyalty & Credit (`@cc/service-loyalty`)

- Credit position: composes existing SAP adapter reads (KNKK via `getCreditInfo` — add to contract if absent). Nothing stored.
- Loyalty tiers: thresholds as tenant-configurable registry in DB, computed from mock VBRK aggregates; FY-aware (Apr–Mar).
- Credit-limit-increase requests: portal-owned, approval-tracked (reuse onboarding approval pattern).

### A6. Reports & Analytics (`@cc/service-reporting`)

- Read-only aggregation over SAP adapter reads + portal data; cache aggressively (Redis, per-tenant keys, data-as-of timestamps rendered via `SapSyncIndicator`).
- Routes `/reports` (sales dashboard) + AR summary with `AmountAging` drill-down. Recharts, per docs/05 §7.10.

### A7. Notification engine (`@cc/adapter-notifications` + worker)

- Interface + mock (console/log) driver; email driver (SMTP/provider) behind the same interface. Templates registry in domain (event → channel → template).
- Consumes outbox events from A1–A6: order confirmed, quote received, dispatch, invoice, payment posted, ticket updates, SLA warnings.
- In-app bell inbox (tenant-scoped `notifications` table) + `/api/notifications` + top-bar UI.

---

## 3. Track B — Production substrate (parallel-friendly after A1)

### B1. Secrets & tenant credential vault

- Envelope-encryption module in `@cc/db` or new `@cc/crypto`: per-tenant data key wrapped by a master key (env-provided locally; KMS in prod). All tenant SAP/GSP/gateway credentials move to encrypted columns. ADR it.

### B2. Real payment gateway (Razorpay first)

- Implement `razorpay` driver behind the existing `PaymentGatewayAdapter` interface: order create, checkout, **signature-verified webhook** (ADR-021 idempotency preserved). Sandbox-keys config per tenant. The webhook route already exists — driver swap only.

### B3. Observability & ops hygiene

- pino structured logs (tenantId/requestId correlation), OpenTelemetry traces around adapter calls, `/api/health` + readiness, Sentry (or equivalent) wiring, per-tenant rate limiting at middleware.

### B4. Reconciliation & exception queues

- Nightly jobs (worker): payment↔gateway↔SAP-posting reconciliation; stuck-outbox sweep; SAP-sync failure tray surfaced in admin (`/admin/exceptions`).

### B5. Platform operator console (`apps/ops`)

- Minimal but real: operator auth (separate realm), tenant provisioning wizard (create tenant, domains, module toggles, credentials), tenant health dashboard (queue depth, SAP connectivity, error rates), usage metering read-model. Billing integration can stub behind an interface.

### B6. GA hardening checklist (tracked as issues, not code-first)

- Security: dependency audit, authz test sweep (every route × role), cross-tenant fuzz tests extended, secrets scan.
- Load test (k6) on catalogue/order/payment paths; DR: backup/restore drill documented; runbooks per failure mode (SAP down, gateway down, queue backlog); status page.

---

## 4. Track C — Real integrations & pilot (needs external access)

| Item                                                     | Prereq                                                          | Notes                                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C1. SAP ECC or S/4 driver against design-partner sandbox | Partner access, connectivity choice (agent vs VPN per TRD §4.4) | Implement only contract methods used by shipped modules; certify with a replayable integration test suite against the sandbox |
| C2. GSP integration: e-invoice IRN + e-way bill          | GSP credentials (tenant-provided)                               | New `@cc/adapter-einvoice`, `@cc/adapter-eway` — interface + mock first, then GSP driver                                      |
| C3. GSTN live validation                                 | GSTN/GSP API access                                             | Swap mock in existing `@cc/adapter-gstn`                                                                                      |
| C4. Pilot: 1–2 tenants, real transaction volume          | B1–B4, C1                                                       | Feature-flag real drivers per tenant; run mock and real side-by-side                                                          |

**Definition of pilot-ready:** Track A complete · B1–B4 complete · C1 certified for onboarding/catalogue/order/invoice/payment · reconciliation green for 2 consecutive weeks on sandbox volume.

---

## 5. Working rules (unchanged, restated)

Everything in CLAUDE.md still binds: boundaries, mock-first, registries-not-duplication, `runWithTenant`, 404-not-403, sequential build order with green CI between phases, ADR every ambiguity. New packages follow the same README + test conventions. The one boundary change (workers edge, A1) must be added to `packages/config/eslint/base.js` and recorded in DECISIONS.md before use.
