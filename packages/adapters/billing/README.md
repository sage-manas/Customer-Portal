# @cc/adapter-billing

Billing behind an interface, per docs/07 B5 ("billing integration can stub
behind an interface") and CLAUDE.md rule 2 (contract-first, mock driver
first, for every external system). There is exactly one driver, `mock`,
because there is no real billing provider integrated yet — the contract
shape is what makes adding one additive rather than a rewrite.

## Public API

- `BillingAdapter` — `getPlanForTenant(tenantId)`.
- `createBillingAdapter()` — one adapter instance per process, like
  `@cc/adapter-cache`: billing is a platform-wide choice, not a per-tenant
  driver the way SAP/GSTN/the payment gateway are.
- `MockBillingAdapter` — returns a static stub plan (`starter`, 10 seats),
  labelled `source: "mock"` so a caller never mistakes the stub for a real
  contract.

## How to test

```
pnpm --filter @cc/adapter-billing test
```
