# @cc/service-sap

The seam between the app and the SAP adapter layer. Exists so `apps/*` never imports `@cc/adapter-sap` directly — the dependency rule is `apps -> ui, services, domain, config` and `services -> adapters` (CLAUDE.md rule 1).

## Public API

| Export                                     | Purpose                                                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSapAdapterForTenant(tenantId)`         | Reads the tenant's stored SAP connection config and returns its `SapAdapter` via the factory. Credentials are referenced (`kms://<tenant>/sap`), never inlined — the KMS envelope pattern of docs/02 §2/§9. |
| `getDashboardSummary(adapter, kunnr)`      | Composed read behind the Customer Dashboard (docs/05 §7.0): open-order and pending-invoice KPIs, credit position, recent orders/invoices, credit-hold flag, and the composite freshness.                    |
| `isSapError`, `FreshnessClass`, `SapError` | Re-exported so app code can render freshness and translate errors without importing the adapters layer.                                                                                                     |

## Degradation

`getDashboardSummary` returns an empty-but-valid summary flagged `stale` when SAP is unreachable, so the dashboard renders with the outage banner instead of a 500 (docs/05 P7). A validation or not-found error still throws — a bug must not disguise itself as an outage.

The composite is only as fresh as its least-fresh part: if any underlying read is `cached`/`stale`, the summary reports that.

## Where this goes next

`dashboard.ts` moves to `packages/services/reporting` when that module is built (Phase 6). Its return shape is the contract, so moving it won't touch the page. Per-module services (`order/`, `invoice/`, …) arrive with their own phases and depend on the same `SapAdapter`.

## How to test

```
pnpm --filter @cc/service-sap test
```

Runs against `MockSapAdapter`, so the aggregation, credit-hold flagging and outage degradation are all covered without a database or a SAP system.
