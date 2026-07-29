# @cc/service-inquiry

Inquiry and quotation — docs/03 Module 3, docs/05 §7.3.

## Purpose

SAP owns both documents: an inquiry is VBAK AUART=IN, a quotation is AUART=AG. So ADR-016 applies exactly as it does to orders, deliveries and invoices — **neither document is stored**, every read composes `SapAdapter` calls and carries their freshness, and the list, the countdown and the totals card are all derived per request.

The portal's only rows here are **inquiry drafts** (`InquiryDraft` / `InquiryDraftLine`): half-filled forms with no VBELN, no ATP and no price, which SAP has no concept of. Once submitted, the row survives only as the link between the form the customer filled in and the inquiry it became.

**The sold-to account is the boundary.** SAP reads a sales document by VBELN alone, so every customer-plane entry point compares the document's own KUNNR to the session's and answers **404** on a mismatch — never 403, which would confirm that another customer's quotation exists (CLAUDE.md rule 5).

## There is no "Expired" status

A quotation lapses because a date passed, not because anything happened to it — SAP leaves it GBSTK=A forever. So expiry is **derived from VBAK-BNDDT on every read** (`quotationValidity` in `@cc/domain`) and never stored or encoded as a `CanonicalStatus`, whose vocabulary docs/05 §6.5 fixes. The same quotation moves from `expiring` to `expired` between two page loads with nothing written anywhere, which is the behaviour a stored flag could not give and would eventually contradict.

`quotationAcceptBlock` returns _why_ a quotation can't be accepted — `expired`, `converted` or `closed` — rather than a boolean, because those need different next steps and a disabled button with no explanation is the worst version of all three.

## Public API

```ts
import {
  // customer plane
  listInquiries, // (adapter, ctx, { filter }) -> the account's inquiries + waiting state
  getInquiry, // (adapter, ctx, vbeln) -> inquiry + its quotation; 404 on KUNNR mismatch
  createInquiry, // (adapter, ctx, input) -> VA11, then the inquiry.created event
  listQuotations, // (adapter, ctx, { filter, now }) -> soonest to lapse first
  getQuotation, // (adapter, ctx, vbeln, { now }) -> validity + tax + acceptBlock
  acceptQuotation, // (adapter, ctx, vbeln, { shipTo, ... }) -> VA01 with reference
  requestRevision, // (adapter, ctx, vbeln, { comment }) -> also the revalidation ask
  // drafts (the only stored part)
  saveDraft,
  getDraft,
  listDrafts,
  deleteDraft,
  markDraftSubmitted,
  countDrafts,
  // back office — no KUNNR, guarded by `quotation:issue`
  listInquiryQueue, // longest-waiting first, across every account
  getInquiryForAgent,
  issueQuotation, // VA21, then the quotation.issued event
  InquiryError,
  isInquiryError,
} from "@cc/service-inquiry";
```

Domain logic it consumes rather than reimplements (`@cc/domain`): `inquiryWriteSchema` / `inquiryDraftSchema` (derived from the `inquiryMapping` registry), `toCreateInquiryInput`, `quotationValidity`, `quotationAcceptBlock`, `canRequestQuotationRevision`, `quotationTax` (which delegates to `invoiceTax`, so the portal never computes GST), `mapPresalesGbstkToStatus`.

## Two planes, two files

`inquiry-service.ts` / `quotation-service.ts` are the customer's; `workbench-service.ts` is the sales desk's. They are separate files with separate entry points rather than one set of functions with a `visibility` flag, for the reason ADR-028 gives about support tickets: the wider capability should be a different function, reachable only through routes guarded by `quotation:issue`, not an argument a customer-plane caller could pass the wrong way round.

The same split runs into the adapter contract. `getInquiries(kunnr)` is the customer's read and `getInquiryQueue()` is the back office's — a queue that was `getInquiries()` with an optional KUNNR would be one forgotten argument away from handing a customer every account's inquiries.

## Events, and why they are written after the fact rather than with it

ADR-023 asks for the outbox row to be written inside the transaction that made the fact true. A module that stores nothing has no such transaction — the fact was made true in SAP. So the ordering is SAP first, event second, in its own transaction, and **a failure to record the event never fails the caller** (ADR-030): the document exists either way and the customer can see it on their list, whereas telling somebody their inquiry failed when SAP is holding it would be a lie.

| Event                          | Written by        | Queue         |
| ------------------------------ | ----------------- | ------------- |
| `inquiry.created`              | `createInquiry`   | notifications |
| `quotation.issued`             | `issueQuotation`  | notifications |
| `quotation.accepted`           | `acceptQuotation` | notifications |
| `quotation.revision.requested` | `requestRevision` | workflow      |

None has a handler yet — A7 consumes them for the bell inbox and email. An event with no consumer is a legitimate no-op (ADR-023).

## Testing

```
pnpm --filter @cc/service-inquiry test              # units, mock SAP, no database
pnpm --filter @cc/service-inquiry test:integration  # draft -> order flow; needs Postgres
```

The integration suite needs a database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```

It covers drafts, the full draft → inquiry → quotation → accept → order chain, the events each step owes, and the cross-account and cross-tenant 404 cases. The unit suite covers the read side, the derived validity states and the acceptance gate against the mock driver.

## Mock behaviour worth knowing

`MockSapAdapter` auto-quotes an inquiry after `autoQuoteAfterMs` (default 90s) so a demo moves without a sales user, but it never overrules a quotation issued through the workbench, and it deliberately does not fire while the back office is reading its own queue. Tests set the delay to 0.
