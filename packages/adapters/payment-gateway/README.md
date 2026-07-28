# @cc/adapter-payment

Payment gateway behind one interface, with a mock driver built first.

Docs: `docs/02-TRD-ARCHITECTURE.md` §6, `docs/03-FUNCTIONAL-SPEC.md` Screen 7.2,
`docs/05-UI-UX-DESIGN.md` §7.7.

## Purpose

Taking money is an external system like SAP or GSTN, so it sits behind
`PaymentGateway` (`src/contract.ts`) with per-tenant driver resolution. Service
code depends on the interface and resolves a driver through
`createPaymentGateway` — it never imports a driver directly.

The contract is shaped around the one thing that makes gateways different from
the portal's other externals: **the webhook is the source of truth, not the
browser redirect.** A customer's tab can close, lose signal or be replayed; the
signed server-to-server callback cannot. So signature verification and webhook
parsing are first-class operations on the interface, not implementation details
of whoever happens to receive the HTTP request.

## Public API

```ts
import {
  createPaymentGateway, // per-tenant factory (the only way to get a driver)
  resetPaymentGateway, // drop cached gateways (config change, tests)
  PaymentGatewayError, // typed errors: invalid_request | not_found |
  //   invalid_signature | unavailable | not_implemented
  isPaymentGatewayError,
  MockPaymentGateway, // the mock, for tests that want it directly
  signWebhook, // HMAC-SHA256 helper — mints a valid test callback
  outcomeFor, // which outcome a given amount produces on the mock
} from "@cc/adapter-payment";
```

`PaymentGateway` itself:

| Method                                       | What it does                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `health()`                                   | Cheap probe for ops checks.                                                                                                                |
| `createOrder(input)`                         | Creates the attempt. **Idempotent on `input.reference`** (the portal payment id) — a double-clicked Pay button costs nothing.              |
| `getPayment(ref)`                            | Polls one attempt — the Pending return state.                                                                                              |
| `verifyWebhookSignature(rawBody, signature)` | HMAC over the **raw** body. Takes a string, not an object: re-serializing JSON changes the bytes and breaks every signature scheme in use. |
| `parseWebhook(rawBody, signature)`           | Parses a callback, refusing outright if the signature doesn't verify — the check can't be skipped by accident.                             |

## Drivers

| Driver     | State    | Notes                                                             |
| ---------- | -------- | ----------------------------------------------------------------- |
| `mock`     | Complete | In-memory. Built first; what every pre-production tenant runs on. |
| `razorpay` | Skeleton | Throws `not_implemented` (ADR-006), wired up in Phase 7.          |

`RazorpayGateway.verifyWebhookSignature` is the one skeleton method that is
genuinely implemented rather than stubbed. It needs no network, and a signature
check returning `false` because "the driver isn't finished" would be
indistinguishable from an attack in the logs.

### What the mock simulates

Three things, because all three ship broken if the mock only walks the happy
path:

1. **Nothing is captured by `createOrder`.** A payment only advances when a
   signed webhook arrives — the same shape Razorpay will send.
2. **Signatures are real** (HMAC-SHA256, constant-time compare). `signWebhook`
   is the only way to mint a valid callback.
3. **Delivery is at-least-once.** `parseWebhook` is pure and never suppresses a
   replay itself — deduplication belongs to the service, where the database
   constraint is, and the mock makes that testable.

Outcomes are deterministic in the amount's paise, so every return state in
docs/05 §7.7 is reachable without a fake bank:

| Amount ends in | Outcome                        |
| -------------- | ------------------------------ |
| `.11`          | `pending` (the polling banner) |
| `.13`          | `failed` (the retry state)     |
| anything else  | `captured`                     |

`MockPaymentGateway.buildWebhook(ref)` returns the signed callback for an
attempt. It is a test/dev affordance, not part of the contract — the payments
service exposes it as `completeMockCheckout`, which still delivers it through
the normal webhook handler.

## Testing

```
pnpm --filter @cc/adapter-payment test
```

Covers create-idempotency, signature verification (tampered body, wrong secret,
malformed signature), the webhook-advances-the-payment rule, replay safety, the
deterministic outcomes, and the outage path. The factory suite additionally
asserts that the Razorpay skeleton fails loudly rather than falling back to the
mock — the rule matters more here than anywhere else in the codebase, because a
fallback would tell a customer their money had been taken when no gateway was
ever called.
