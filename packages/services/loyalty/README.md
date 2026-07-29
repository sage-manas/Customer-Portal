# @cc/service-loyalty

Loyalty and credit — docs/03 Module 9, docs/05 §7.9.

## Purpose

The module that stores least. SAP owns every number on both screens: KNKK holds the credit limit and the exposure, VBRK holds what the customer bought this year, KONA holds the rebate agreement and what has accrued under it. So ADR-016 applies with nothing left over — **no credit position, loyalty tier or DSO is ever stored**. All three are comparisons against numbers SAP returned, derived on every read exactly as a quotation's validity is (ADR-031), and every read carries its freshness.

Two things sit either side of that and _are_ the portal's own rows:

- **The tenant's tier thresholds** (`LoyaltyTierSetting`) — what _this_ tenant considers a Gold customer, which is a commercial policy SAP has no field for. A row per tier, and an absent row means the `@cc/domain` registry's default still applies.
- **A customer's credit-limit increase request** (`CreditLimitRequest`) — a portal workflow, because SAP records a limit and not a conversation about one.

**The sold-to account is the boundary.** Every customer-plane entry point takes the KUNNR from the session, and `readOwnedCreditRequest` answers **404** on a mismatch — never 403, which would confirm that another customer's request exists (CLAUDE.md rule 5).

## Approving a request does not change the customer's limit

This is the one thing to be clear about before reading anything else. `decideCreditRequest` records that the tenant's credit desk agreed to a figure. It does **not** write KNKK-KLIMK: there is no adapter method that does, deliberately (ADR-035), because a customer portal is not where a credit master is maintained. The limit moves when somebody in the tenant maintains it in FD32, and until then `getCreditInfo` — which is the only answer to "what is my limit?" anywhere in the portal — keeps returning the old one.

Both screens say so in as many words, and so does the `credit.increase.decided` event's description. A portal that implied otherwise would have customers ordering against a limit that does not exist yet and discovering the truth as a credit block.

## The tier is derived, and has no moment of change

`loyaltyStanding(ytdValue, thresholds)` places an account on the tenant's ladder on every read. Nothing about a customer's tier is stored, which has one consequence worth stating: a tenant that edits its thresholds re-tiers every customer on their next page load, with no migration, no backfill and nothing anywhere that can disagree with the settings screen.

It also means there is **no `loyalty.tier.changed` event**. A tier changes because a threshold was crossed by an invoice that was posted for its own reasons, or because the tenant moved the threshold — neither is a transaction about the tier, so there is nothing to attach an event to (ADR-023's requirement) and nothing that could be swept for it usefully (ADR-029's alternative). If A7 wants a "you've reached Gold" notification, the honest place to derive it is from `invoice.posted`, comparing the standing before and after that document.

## Public API

```ts
import {
  // customer plane — KUNNR from the session
  getCreditPosition, // (adapter, ctx, { today, periodDays }) -> gauge + DSO + freshness
  getLoyaltyPosition, // (adapter, ctx, { today }) -> tier, FY range, live rebates
  listCreditRequests, // (ctx) -> the account's history + the one still pending
  getCreditRequest, // (ctx, id) -> 404 on KUNNR mismatch
  requestCreditIncrease, // (adapter, ctx, input) -> row + credit.increase.requested
  withdrawCreditRequest, // (ctx, id) -> the only transition a customer may make
  // credit desk — no KUNNR, guarded by `credit:decide-limit`
  listCreditRequestQueue, // ({ tenantId }, { filter }) -> tenant-wide, oldest first
  getCreditRequestForDesk,
  decideCreditRequest, // approve (optionally for less) or decline
  getCreditPositionForDesk, // the position of the account being decided on
  // tenant settings
  getTierThresholds, // registry defaults + this tenant's overrides
  saveTierThresholds, // validated as a whole ladder, never field by field
  LoyaltyError,
  isLoyaltyError,
} from "@cc/service-loyalty";
```

Domain logic it consumes rather than reimplements (`@cc/domain`): `creditPosition` / `creditBand` / `utilizationRatio` (the >80% and >95% thresholds live there, not in the gauge), `computeDso` / `dsoFromDocuments`, `fiscalYearRange` / `fiscalYearPurchases`, `loyaltyStanding` / `resolveTierThresholds` / `tierThresholdOverridesSchema`, `creditIncreaseRequestSchema` / `creditRequestDecisionSchema` / `creditIncreaseIssue`, `CREDIT_REQUEST_TRANSITIONS` / `canTransitionCreditRequest`, `activeRebateAgreements` / `totalAccruedRebate`.

## Two planes, two files

`credit-service.ts`, `loyalty-service.ts` and `credit-request-service.ts` are the customer's; `credit-desk-service.ts` is the back office's. Separate files with separate entry points rather than one set of functions with a flag — ADR-028's rule, and the reason the desk's queue cannot be reached by a customer-plane call that forgot to pass an account (ADR-032, applied here to the portal's own rows rather than to a SAP read).

## Events

Unlike A4's documents, these rows are the portal's own, so ADR-023 applies in its strict form: the outbox row is written **inside the transaction that creates or decides the request**.

| Event                       | Written by              | Queue         |
| --------------------------- | ----------------------- | ------------- |
| `credit.increase.requested` | `requestCreditIncrease` | notifications |
| `credit.increase.decided`   | `decideCreditRequest`   | notifications |

Withdrawing writes no event: nobody is waiting to be told that somebody stopped asking, and the desk sees it leave the queue, which is the whole of the effect.

Neither has a handler yet — A7 consumes them for the bell inbox and email. An event with no consumer is a legitimate no-op (ADR-023).

## What this module deliberately does not do

- **Write to SAP.** Not the credit limit (above), and not the rebate accrual — KONA-KAWRT is a settlement figure, and a portal that recomputed money owed to a customer would eventually disagree with the tenant's own settlement run. Every write in this package goes to Postgres.
- **The blocked-order release queue.** docs/05 §8 puts it on the same desk as the limit requests, and `/admin/credit` is where it belongs. It needs a tenant-wide read of credit-blocked sales orders, which the adapter does not have — and which must be a method of its own rather than `getOrders` with the KUNNR dropped (ADR-032). Adding it is a contract change plus a mock, not a change to this service's shape.
- **Enforce one pending request structurally.** `requestCreditIncrease` checks, because "only one row where `state = pending`" needs a partial unique index and Prisma's schema language cannot express one. The race it leaves is benign — two simultaneous submissions make two pending rows, which is untidy for the desk rather than dangerous, since nothing is granted by either.

## Testing

```
pnpm --filter @cc/service-loyalty test              # units, mock SAP, no database
pnpm --filter @cc/service-loyalty test:integration  # request -> decide flow; needs Postgres
```

The integration suite needs a database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```

The unit suite covers the credit position against the mock landscape — the healthy, near-limit and blocked bands, the missing-DSO case, and the degraded read where BSID fails but KNKK answers. The integration suite covers the tenant's ladder (including a tenant that re-tiers its customers by editing a threshold, and one that tries to save a ladder that doesn't ascend), the rebate filter, and the whole request → queue → decide → withdraw workflow with its events, its cross-account 404 and its cross-tenant 404. `apps/web/e2e/account.spec.ts` walks the same path through the screens.

## Seeded data worth knowing

`MockSapAdapter` seeds account `0010001001` with about ₹69 lakh of fiscal-year billing, which lands it on **Silver** with a little over half the way to Gold — so the tier card and its progress bar are both meaningful in a fresh demo rather than pinned at the entry tier. `0010001002` sits just under its limit (the `critical` band) and `0010001003` is over it and blocked. Two rebate agreements are seeded for `0010001001`, one running and one lapsed, so the "only live agreements" filter is visible rather than assumed.
