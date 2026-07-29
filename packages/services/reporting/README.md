# @cc/service-reporting

Reports & analytics — docs/03 Module 10, docs/05 §7.10.

## Purpose

The module that computes most and owns least. Every figure on `/reports` is an aggregate over documents SAP owns: VBAK for orders by month and top products, VBRK for the year's purchases, LIKP for on-time delivery, BSID for the aging bar. So ADR-016 applies in its strongest form — **nothing is stored, and there is no table**. This package has no `@cc/db` dependency at all, like `@cc/service-invoice`.

What it does have, and what A6 is really about, is the cache ADR-016 and ADR-033 both promised. Aggregating a year of documents on every page load is the cost those ADRs accepted and then deferred; `@cc/adapter-cache` is where the deferral is paid off, and the reason it is honest is that **a cached report says it is cached** (ADR-036). `SapSyncIndicator` renders `freshness: "cached"` and the original `syncedAt` from the SAP read that filled the entry — not the moment the cache answered. A projection table would have reported nothing, which is exactly why there isn't one (ADR-037).

## Aggregation lives in the domain, not here

`ordersByMonth`, `topProducts`, `aovTrend`, `onTimeDelivery`, `salesKpis` and `purchaseTotal` are all in `@cc/domain/entities/reporting`. This package composes adapter reads, hands the arrays over, and caches the answer. That is ADR-015's rule for the O2C timeline applied to arithmetic: a chart and a KPI tile showing the same quantity must be able to disagree only if the data differs, never because two files bucketed a month differently.

Three judgements worth knowing, because they are the ones a reader will question:

- **A fully rejected order is excluded from every chart.** It is a document SAP still holds and the orders list still shows, but it is not demand — counting it would let a customer's chart rise by cancelling things. The mock seed carries one on purpose, so a regression that counted it would fail a test rather than look plausible.
- **Top products are grouped from order lines, not billing lines.** `Invoice` on this contract is a header with tax conditions and no items (ADR-018), and inventing a line-level billing read to feed a chart would put a method on the contract that ECC and S/4 owe in Phase 7 for no reason. Doc 03 names VBAP for this figure anyway.
- **On-time delivery reports what it could not measure.** A shipment with no planned goods-issue date is counted as `unmeasured` rather than as on time, and one that has not shipped is `pending`, not late. Folding either into the denominator would let a tenant's OTD rise by not planning.

## Two questions the cache TTLs answer differently

`REPORT_CACHE_TTL_SECONDS` (a `@cc/domain` registry, per docs/02 §4.3's "per-entity TTLs") gives the sales dashboard 15 minutes and the AR summary 2. The AR screen is what a customer reads **while deciding what to pay**, and a five-minute-old balance can be a payment they have already made; a trend does not move in a quarter of an hour. The customer dashboard (`getDashboardSummary`, moved here from `@cc/service-sap`) is not cached at all — it is the screen someone opens to see whether anything changed since they last looked.

A read that came back from SAP already `stale` is **never written to the cache**. Caching a degraded answer extends one SAP outage into fifteen minutes of everyone being told the same wrong thing, long after SAP came back.

## Public API

```ts
import {
  getSalesReport, // (adapter, ctx, { period?, today?, refresh?, store? }) -> Cached<SalesReport>
  getArSummary, // (adapter, ctx, { today?, refresh?, store? }) -> Cached<ArSummary>
  getDashboardSummary, // (adapter, kunnr) -> DashboardSummary  (moved from @cc/service-sap)
  getReportCache, // the process-wide store; redis when REDIS_URL is set, memory otherwise
  invalidateTenantReports,
  resolvePeriod,
  ReportingError,
  isReportingError,
} from "@cc/service-reporting";
```

## The sold-to account is the boundary, and there is no desk plane

Every adapter read below is KUNNR-scoped and takes the account from the session. There is deliberately **no** `getSalesReportForDesk`: a tenant-wide sales report needs its own adapter methods, not these with the account argument left off (ADR-032). The KUNNR is also part of every cache key, so two customers on one tenant cannot share an entry — and the tenant is part of it before that, enforced by `cacheKey()` itself.

## Testing

```
pnpm --filter @cc/service-reporting test
```

Unit only — the module stores nothing, so there is no database flow to integrate against. The suite asserts the cache's observable promises directly: a second read hits the cache and is labelled `cached` with the _first_ read's `syncedAt`; a different tenant, customer or period misses; `refresh` recomputes; a `stale` read is not written; and a SAP outage becomes a retryable 503 rather than a crash.
