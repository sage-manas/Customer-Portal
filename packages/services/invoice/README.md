# @cc/service-invoice

Billing & Invoices (docs/03 Module 6, docs/05 §7.6).

## Purpose

Everything the invoice list, the invoice detail screen and the credit/debit
notes tab need. **Nothing in this module is stored** — SAP owns billing
documents, so every read composes `SapAdapter` calls and carries their
freshness, exactly as the order module does (ADR-016). An invoice is a
statutory record; a mirrored copy that drifted from VBRK would be worse here
than anywhere else in the portal, because the customer's accounts team
reconciles against it.

That is also why this package has no `@cc/db` dependency and no integration
suite: there is no database involved.

Two rules run through every function:

1. **The sold-to account is the boundary.** `getInvoice` compares the
   document's KUNNR to the session's and answers **404** on a mismatch, never
   403 — SAP reads a VBRK by VBELN alone, so this check is the control, not a
   convenience (CLAUDE.md rule 5).
2. **The portal never computes tax.** CGST/SGST/IGST come off KONV as SAP
   calculated them (docs/02 §5). `invoiceTax` in `@cc/domain` only _reads_
   which conditions were applied, to describe the place of supply.

## Public API

```ts
import {
  listInvoices, // filtered list + aging summary
  listCreditDebitNotes, // the G2/L2 tab (ADR-020)
  getInvoice, // one document + tax + FI position + O2C timeline
  getInvoicePdfUrl, // re-checks ownership; a URL is shareable
  InvoiceError, // not_found | no_account | upstream_unavailable
  isInvoiceError,
  // desk plane — no KUNNR anywhere; guarded by `finance:ar` / `finance:ap`
  listInvoiceRegister, // every F2 in the tenant (AR workspace)
  listNoteRegister, // every G2/L2 in the tenant (AP workspace)
  listRefundQueue, // credit notes whose FI item is still open
} from "@cc/service-invoice";
```

`register-service.ts` is a separate file from `invoice-service.ts` for ADR-032's
reason: the desk's read is a different function, not the customer's with the
account left off. It reads through `getBillingRegister()`, likewise its own
adapter method. `listRefundQueue` composes two reads — the note is VBRK, whether
it has been settled is BSID — and settles nothing: paying a credit out is F-58
(ADR-059).

Callers pass the `SapAdapter` in (resolved from `@cc/service-sap`), because a
service may not import another service — ADR-011.

`listInvoices` excludes credit and debit notes by default. They are billing
documents on the same type (ADR-020) but they are not bills: a credit sitting
in a list of invoices reads as money owed when it is the opposite.

### Degradation

The AR read behind the aging summary, and the order/delivery reads behind the
timeline, are all best-effort. A failed BSID read costs the customer their
aging bar, not their invoices — the invoice is what they came for. What is
never best-effort is the ownership check.

## Testing

```
pnpm --filter @cc/service-invoice test
```

Runs against the mock SAP driver; no database or Postgres needed. Covers the
filters, the notes split, the tax split on both intra- and inter-state seeded
invoices, the aging summary, the payability rules, and the cross-customer 404 —
including that a missing invoice and someone else's give the identical answer.
