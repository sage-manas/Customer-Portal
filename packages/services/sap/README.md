# @cc/service-sap

The seam between the app and the SAP adapter layer. Exists so `apps/*` never imports `@cc/adapter-sap` directly — the dependency rule is `apps -> ui, services, domain, config` and `services -> adapters` (CLAUDE.md rule 1).

## Public API

| Export                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSapAdapterForTenant(tenantId)`         | Reads the tenant's stored SAP connection config and returns its `SapAdapter` via the factory. Connection parameters and credentials come from the per-tenant envelope vault (ADR-042), keyed by `SAP_CONNECTION_FIELDS` in `@cc/domain` — the same registry the ops console's SAP configuration screen renders from (ADR-053). `SAP_ECC_ENDPOINT` and friends remain a fallback for tenants configured before that screen existed; a stored value always wins. |
| `resetSapAdapterForTenant(tenantId)`       | Drops the cached adapter. The factory caches one per tenant (it owns the pool and the circuit breaker), so a configuration change nobody invalidated keeps talking to the previous system until the process restarts. The ops console calls this after every SAP config write and before a connection test.                                                                                                                                                    |
| `isSapError`, `FreshnessClass`, `SapError` | Re-exported so app code can render freshness and translate errors without importing the adapters layer.                                                                                                                                                                                                                                                                                                                                                        |

## Degradation

`getDashboardSummary` used to live here and moved to `@cc/service-reporting` in A6, as the note below always said it would. Only the import changed; the return shape was the contract.

The composite is only as fresh as its least-fresh part: if any underlying read is `cached`/`stale`, the summary reports that.

## Where this goes next

`dashboard.ts` moved to `packages/services/reporting` in A6, leaving this package with the single job it was always for: resolving a tenant's adapter so `apps` never imports `@cc/adapter-sap`. Per-module services (`order/`, `invoice/`, …) arrive with their own phases and depend on the same `SapAdapter`.

## How to test

```
pnpm --filter @cc/service-sap test
```

Runs against `MockSapAdapter`, so the aggregation, credit-hold flagging and outage degradation are all covered without a database or a SAP system.
