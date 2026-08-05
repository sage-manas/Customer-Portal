# Runbook: Payment gateway unreachable, or its webhook stops arriving

## The two failure shapes are different

Payments are the one O2C document the portal stores outright (ADR-019),
specifically because there is a real window — between the gateway capturing
money and SAP clearing the item — where nothing else accounts for the
debit. That window is exactly where this runbook lives, and it splits into
two distinct failures with different symptoms:

1. **The gateway itself is unreachable** (checkout page won't load, or
   `initiatePayment` can't create a gateway order). Customers see a payment
   failure at the point of trying to pay — `payments/pay` errors out.
   Nothing is stored yet (`initiatePayment` charges nothing — ADR-021), so
   there is no stuck state to clean up. This is closer to the SAP-down
   runbook in shape: wait it out, nothing to reconcile.
2. **The gateway captured money but its webhook never arrived** (gateway
   outage on _their_ side, or a network partition between it and this
   portal). This is the one that needs action: a `Payment` row sits in
   `initiated` with a `gatewayReference` set, and — per ADR-044's
   threshold — becomes a `payment_capture_unconfirmed` exception in
   `/admin/ap` (Reconciliation) after 30 minutes.

## Confirming which one you're looking at

- `/admin/ap` (Reconciliation) → any `payment_capture_unconfirmed` rows: shape 2.
  `listPaymentExceptions` (`@cc/service-payment`) is what populates this;
  each row shows the account, amount and how long it's been waiting.
- No exceptions, but customers reporting checkout failures: shape 1 — check
  the gateway's own status page and `packages/adapters/payment-gateway`'s
  configured driver/credentials for the affected tenant(s)
  (`getTenantCredential(tenantId, "payment_gateway")`).

## Recovering a stuck `initiated` payment (shape 2)

`reconcilePayment` (`@cc/service-payment`) is what both the automatic sweep
(`packages/workers/src/reconciliation.ts`, `RECONCILIATION_INTERVAL_MS`) and
a human's "Retry" click in `/admin/ap` (Reconciliation) call. For an `initiated`
payment it does **not** wait for the webhook a second time — it polls the
gateway directly (`PaymentGateway.getPayment`), which is safe precisely
because that call is authenticated by the tenant's own resolved
credentials, unlike a webhook body, which is untrusted until its HMAC
signature verifies (docs/02 §6). If the gateway confirms the capture, the
payment advances to `captured` and then follows the normal
`postCapturedPayment` path into SAP; if the gateway also has no record of
it, the payment genuinely never captured and stays `initiated` — that is
the correct, honest answer, not a bug to work around.

## What never needs manual intervention

- **`captured` payments waiting on a SAP posting** are a _different_
  exception (`payment_posting_overdue`) with a different cause (SAP down,
  not the gateway) — see `sap-down.md`. Don't confuse the two when triaging
  `/admin/ap` (Reconciliation); the row's `label` tells you which.
- **Idempotency.** A webhook that eventually arrives late, or arrives twice,
  is a no-op the second time — `Payment.lastEventId` is the dedupe key
  (ADR-021), and there is no code path that would double-apply a delayed
  webhook once `reconcilePayment` has already polled the gateway directly.

## Never do this

Do not manually set a `Payment.state` to `posted` in the database to "clear"
an exception. `postedAt`/`fiDocumentNumber` are the _record_ of a real SAP
posting (ADR-019) — writing them by hand creates a payment that claims money
was posted to SAP when it wasn't, which is a worse state than a visible,
honest exception in `/admin/ap` (Reconciliation).
