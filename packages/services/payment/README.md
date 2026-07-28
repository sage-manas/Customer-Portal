# @cc/service-payment

Payments & Statement (docs/03 Module 7, docs/05 §7.7, docs/02 §6).

## Purpose

Two halves with different storage stories:

- **The statement** (`statement-service.ts`) stores nothing. BSID/BSAD are
  SAP's, so the account statement, the aging summary and the payable-items
  list are all composed from `SapAdapter` reads carrying their freshness.
- **Payments** (`payment-service.ts`) _are_ stored, and they are the only O2C
  document in the portal that is. Between the gateway capturing money and SAP
  clearing the open items there is a real debit against a real customer that
  no FI document yet accounts for. Everything else can be re-read from SAP;
  that window cannot (**ADR-019**).

Three rules hold throughout:

1. **The webhook is the truth, not the browser.** `initiatePayment` never marks
   anything paid — it records the intent and returns a checkout URL. Only a
   _signed_ webhook advances a payment, so a customer whose browser died
   mid-redirect still gets their payment posted.
2. **Every step is idempotent.** Gateways deliver at least once. The gateway
   reference and the event id are both unique per tenant in the database, and
   `postIncomingPayment` is itself idempotent on the reference (ADR-021).
3. **Capture and posting are separate states.** If SAP refuses the posting the
   money has still been taken: the payment stays `captured` and goes to
   reconciliation. It is never rolled back to `failed`, which would tell the
   customer their money is safe when it isn't.

## Public API

```ts
import {
  // Statement half — no database
  getStatement, // running balance + aging, with date/doc-type filters
  listPayableItems, // open items the customer may select (step 1)

  // Payment half — stored
  initiatePayment, // validate against SAP, record intent, create attempt
  handleGatewayWebhook, // verify signature -> dedupe -> capture -> post to SAP
  postCapturedPayment, // retry the F-28 posting (reconciliation)
  getPayment, // one payment, for the receipt
  listPayments,
  listPendingSync, // captured but not yet posted — the `Pending sync` rows
  completeMockCheckout, // dev/demo: deliver the mock's own signed webhook
  getPaymentGatewayForTenant,
  PaymentError,
  isPaymentError,
} from "@cc/service-payment";
```

The gateway is resolved inside this package (it is this module's own external
system, like GSTN is onboarding's). The **SAP adapter is passed in** by the
caller, because a service may not import `@cc/service-sap` — ADR-011.

### Error codes

`PaymentError.code` is what route handlers map to a status:

| Code                   | Status | Meaning                                                                          |
| ---------------------- | ------ | -------------------------------------------------------------------------------- |
| `not_found`            | 404    | No such payment/item _for this customer_. Never 403.                             |
| `invalid`              | 422    | Field validation failed.                                                         |
| `not_payable`          | 422    | Item cleared, not the customer's, or overpaid.                                   |
| `no_account`           | 409    | Session has no sold-to account.                                                  |
| `invalid_signature`    | 400    | Webhook didn't verify — hostile until proven otherwise.                          |
| `gateway_unavailable`  | 503    | Gateway unreachable. **Nothing was charged.**                                    |
| `posting_failed`       | 202    | Money taken, SAP posting outstanding. Not a retry — a retry would take it twice. |
| `upstream_unavailable` | 503    | SAP read failed.                                                                 |

Copy in this module carries an obligation the rest of the portal doesn't: when
something goes wrong around money, the message must say what happened to the
money. "Try again" is not enough if the customer can't tell whether they've
been charged.

## Testing

```
pnpm --filter @cc/service-payment test              # statement half, no DB
pnpm --filter @cc/service-payment test:integration  # payment flow, needs Postgres
```

The integration suite (`docker compose -f docker-compose.dev.yml up -d`, then
`pnpm --filter @cc/db db:push`) walks initiate → signed webhook → F-28 posting
and clearing, and covers: partial payment leaving a residual item, webhook
replay applying exactly once, a tampered signature changing nothing, a failed
payment never touching SAP, a SAP outage leaving the payment `captured` for
reconciliation to retry without double-charging, and the cross-tenant and
cross-account 404s.
