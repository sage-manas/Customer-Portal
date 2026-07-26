# @cc/adapter-sap

The SAP adapter layer — the core technical asset (`docs/02-TRD-ARCHITECTURE.md` §4). One contract, three drivers, resolved per tenant.

## Public API

```ts
import { createSapAdapter, type SapAdapter } from "@cc/adapter-sap";

const sap = createSapAdapter({ tenantId, driver: "mock" });
const { data, freshness, syncedAt } = await sap.getOrders(kunnr);
```

- **`SapAdapter`** (`src/contract.ts`) — the canonical API the app consumes: customer master, catalogue/stock/pricing, order simulate+create, deliveries, invoices, AR open items and incoming payments. Reads return `SapRead<T>` (`data` + `freshness` + `syncedAt`) so every screen can render `SapSyncIndicator` honestly (docs/05 P1); writes return plain results.
- **`createSapAdapter(config)`** (`src/factory.ts`) — the only place a concrete driver is constructed. Adapters are cached per tenant because a driver instance owns connection state (pool, circuit breaker, and for the mock, its store). `resetSapAdapter(tenantId?)` drops the cache after a config change or between tests.
- **`SapError`** (`src/errors.ts`) — typed failures (`validation` / `not_found` / `authorization` / `unavailable` / `not_implemented` / `unknown`) carrying the raw `sapMessage` + `sapMessageId` for logs and admin screens. Services translate these into user-facing copy; the raw SAP text never reaches a customer (docs/05 §11).
- **`MockSapAdapter`** — the driver built first, so nothing blocks on SAP access.
- **`EccSapAdapter` / `S4SapAdapter`** — Phase 7 skeletons. Every method throws `not_implemented` rather than silently degrading to mock data.

**App and service code must never import a driver directly** — only `SapAdapter` via the factory. `apps/*` may not import this package at all (dependency rule); it reaches SAP through `@cc/service-sap`.

## The mock driver

`src/mock/seed.ts` holds a realistic seeded landscape, not canned responses: 12 materials across 5 material groups, per-plant stock (including zero-stock and low-stock rows), customer-specific pricing conditions, three sold-to customers in three states (so intra-state CGST+SGST _and_ inter-state IGST both occur), a closed order, a part-delivered order, an order on credit hold, deliveries with e-way bills, and open/overdue/cleared AR items.

`src/mock/driver.ts` computes over that data rather than returning it verbatim:

- **ATP** confirms against seeded stock; short stock gives a partial confirmation dated by the material's lead time.
- **Credit** is checked against seeded KNKK exposure; an order over the limit comes back `CreditHold` with nothing confirmed, and a released order consumes exposure.
- **MOQ**, missing price conditions, unknown ship-to and duplicate GSTIN all fail as SAP would, with the matching message id.
- **Idempotency** holds for both writes: the same customer PO reference never creates two orders, and the same gateway reference never posts two payments.
- **Cross-customer reads** fail as `not_found`, never `forbidden` — the portal must not confirm another customer's document exists.

Tunable per instance via `MockSapOptions`: `unavailable` (outage simulation for the stale-banner path), `latencyMs` (so loading states are real), `today` (deterministic ATP/aging), `creditToleranceRatio`.

## How to test

```
pnpm --filter @cc/adapter-sap test
pnpm --filter @cc/adapter-sap typecheck
```

The mock driver's suite doubles as the contract suite: when the ECC/S4 drivers are built (Phase 7), point the same cases at them against a sandbox.
