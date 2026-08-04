# @cc/service-customer

The tenant's customer directory — `/admin/customers` (doc 09 §3.4, ADR-057).

## Purpose

Two systems own a customer between them, and this package is where the split
is drawn:

- **SAP owns the customer master.** Name, address, contact, GSTIN and PAN are
  read through the adapter on every request and carry their freshness
  (ADR-016/ADR-007). Nothing about them is stored here.
- **The portal owns whether the account may use the portal.** That is one
  boolean SAP has nowhere to put, so `CustomerAccount` stores it, along with
  the deactivation trail and who registered the customer.

The SAP adapter is passed in by the caller rather than resolved here: it
belongs to `@cc/service-sap`, and a service may not import another (ADR-011).

## Public API

| Function                                                          | What it does                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listCustomerAccounts(tenantId, sap, filter?)`                    | The directory. One `getCustomer` per account; returns `SapRead<CustomerAccountSummary[]>` carrying the weakest freshness of the reads behind it. |
| `getCustomerAccount(tenantId, kunnr, sap)`                        | One customer: master + access row + the logins linked to it. 404s another tenant's KUNNR.                                                        |
| `updateCustomerAccount(tenantId, kunnr, input, sap, actorUserId)` | Writes the master through `updateCustomer` (XD02), validated by the domain's `customerEditSchema`.                                               |
| `setCustomerAccountActive(tenantId, kunnr, input)`                | Deactivate / reactivate. Carries the target state; there is no delete.                                                                           |
| `registerCustomerAccount(tenantId, input)`                        | Records the portal's access row after SAP created the customer. Idempotent, and never reactivates.                                               |
| `assertCustomerCanOrder(tenantId, kunnr)`                         | The order-creation guard, called by the two handlers that create a sales order.                                                                  |

Errors are `CustomerError` (`code`, `status`, `issues`, `upstreamMessage`),
mapped by `toAdminErrorResponse` in `apps/web`.

## What this package deliberately does not do

- **Store a customer's name, GSTIN or address.** If you find yourself adding
  a column for one, the answer is a `getCustomer` call.
- **Write PAN or GSTIN.** `CUSTOMER_EDITABLE_FIELDS` in `@cc/domain` excludes
  them, so they are not in the schema, not in `CustomerPatch`, and there is
  no path from this package to a changed tax identifier (ADR-057).
- **Decide what a deactivation prevents.** It records the decision; identity
  refuses the sign-in and the order handlers refuse the order.

## Testing

```
pnpm --filter @cc/service-customer test              # no database needed
pnpm --filter @cc/service-customer test:integration  # needs Postgres
```

The integration suite needs a local database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```

It runs in CI as its own step and covers the composed list, the 404 boundary
for another tenant's customer, the edit round trip through the SAP mock, and
the deactivation that blocks a new order while deleting nothing.
