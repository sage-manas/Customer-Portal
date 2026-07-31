# Runbook: SAP unreachable or erroring

## How this shows up

Every SAP-owned read in this codebase goes through `SapAdapter` and returns
a `SapRead<T>` carrying a freshness class (ADR-007) — there is no cached
mirror of orders/deliveries/invoices/inquiries/quotations to fall back on
(ADR-016), so an outage is visible immediately rather than masked by a
stale copy:

- Customer-facing pages (`/orders`, `/deliveries`, `/invoices`, `/catalogue`,
  `/inquiries`, `/quotations`, `/account`) render their error state — check
  each service's `is*Error` guard (e.g. `isOrderError`) for the
  `upstream_unavailable`-shaped code your logs show.
- `/reports` degrades more gracefully: `@cc/adapter-cache` is fail-open
  (ADR-036), so a cached figure keeps rendering (labelled `cached`, with its
  **original** `syncedAt` — never silently refreshed) until its TTL expires,
  at which point that KPI/chart also errors.
- Payments: `postCapturedPayment` (the SAP-posting half of a captured
  payment) starts failing; `Payment.state` stays `captured` and the
  **payment itself is not lost** — see the reconciliation section below.
- `/admin/exceptions` (`exceptions:view`, `tenant_admin`) starts showing
  `payment_posting_overdue` rows once captures have waited past 15 minutes
  with no successful posting (ADR-044's threshold).

## First, confirm it's actually SAP and not the mock driver / config

Every tenant's `sapDriver` is `mock` by default (Track A/B are entirely
mock-first); `ecc`/`s4` are still `not_implemented` skeletons pending Track
C. If a tenant is on `mock` and seeing SAP errors, the mock driver itself
threw — check `packages/adapters/sap/src/drivers/mock/*` for a bug, this is
not an "external system is down" incident.

If a tenant is on `ecc`/`s4` (Track C, real credentials): confirm
connectivity first — `getTenantCredential(tenantId, "sap")` (or, once
`apps/ops`'s tenant detail page is extended past its current
`mock`/`not_certified` label, its health tile) tells you which driver a
tenant is actually on.

## While SAP is down

1. **Do nothing destructive.** No adapter method retries writes
   automatically except the payment-posting retry (`postCapturedPayment`,
   itself retried by `packages/workers/src/reconciliation.ts` on
   `RECONCILIATION_INTERVAL_MS`, default 5 minutes) and the outbox relay
   (`OUTBOX_MAX_ATTEMPTS`, default 5, then `failed`). Everything else is a
   read that simply fails per-request — there is no queued write to SAP
   anywhere in this codebase to worry about losing.
2. **Watch `/admin/exceptions`.** It is the one screen that surfaces the
   consequence of a SAP outage that outlives the automatic retry window:
   payments stuck `captured`. Once SAP recovers, `reconcilePayment`'s next
   scheduled pass (or a manual "Retry" click) clears them without any
   operator intervention beyond that click.
3. **Support tickets**: `@cc/service-support` is entirely portal-native
   (ADR-028) and reads/writes nothing from SAP, so it keeps working
   throughout — including a customer's ability to open a ticket reporting
   the outage.
4. **Notifications**: `@cc/adapter-notifications` only reacts to outbox
   events already written; a SAP outage doesn't queue anything new for it to
   send, so there is nothing to catch up on notification-side once SAP
   returns.

## After SAP recovers

- Confirm `/admin/exceptions` drains — `payment_posting_overdue` rows
  should clear within one `RECONCILIATION_INTERVAL_MS` window, or a manual
  retry immediately.
- No backfill is needed for any SAP-owned read (orders, deliveries,
  invoices, inquiries, quotations, catalogue, credit position): every one
  of them re-reads SAP on the next page load, by design (ADR-016). There is
  no cache to invalidate except `@cc/adapter-cache`'s report entries, which
  self-expire on their own TTL.
