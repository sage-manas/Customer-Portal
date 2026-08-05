# @cc/service-order

Sales Order Management (docs/03 Module 4, docs/05 §7.4) — Phase 4.

Framework-free, like every `packages/services` module: no Next.js imports, every DB call inside `runWithTenant`, typed errors that route handlers map to status codes.

## What is stored, and what isn't

- **Orders are SAP's.** `listOrders`, `getOrder`, `checkAvailability`, `createOrder` and `cancelOrder` compose `SapAdapter` calls and carry their freshness (ADR-007). No submitted order is cached — an order's status is precisely the thing a customer refreshes to check, so a stale answer here would be worse than a slow one (docs/05 P1).
- **Drafts are the portal's**, because SAP has no concept of one. A draft is a half-filled form: no VBELN, no ATP, no credit check. It is stored in `SalesOrder` / `SalesOrderLine` and, once submitted, the row is kept only as the record of what that form became — never read back as the order's state.

## Public API

| Function                                                                | Notes                                                                                                                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listOrders(sap, kunnr, { filter })`                                    | Filters are the customer's vocabulary — `open` · `creditHold` · `completed` — not GBSTK codes.                                                                                                            |
| `getOrder(sap, kunnr, vbeln)`                                           | Order + deliveries + invoices + the `O2CTimeline` stages. Cross-customer is a **404**.                                                                                                                    |
| `getOrderFormDefaults(sap, kunnr)`                                      | Ship-to list (VBPA-SH), KNVV-ZTERM, credit position — what the create form needs before anything typed.                                                                                                   |
| `checkAvailability(sap, kunnr, input)`                                  | ATP simulate. Writes nothing; returns per-line confirmed qty/date plus `creditBlockExpected`.                                                                                                             |
| `createOrder(sap, kunnr, input)`                                        | VA01. Idempotent on the customer PO reference, so a double-clicked Submit costs nothing.                                                                                                                  |
| `cancelOrder(sap, kunnr, vbeln, reason?)`                               | Re-reads the status from SAP first — a stale screen cannot cancel an order that has since shipped.                                                                                                        |
| `displayStatus(order)`                                                  | A credit hold outranks GBSTK: it is the status the customer can act on.                                                                                                                                   |
| `saveDraft` / `getDraft` / `listDrafts` / `deleteDraft` / `countDrafts` | Scoped to the sold-to account; another account's draft id is a 404.                                                                                                                                       |
| `listCreditBlockedOrders(sap)`                                          | **Desk plane, no KUNNR.** Orders SAP is holding on credit, longest-waiting first — doc 05 §8's release queue, guarded by `credit:release`.                                                                |
| `releaseCreditBlock(sap, { vbeln, initiatedBy })`                       | VKM3. **Re-runs the credit check** rather than forcing CMGST: `released: false` with SAP's reason is a normal result for an order still over its limit, not an error, and the screen prints it (ADR-059). |
| `markDraftSubmitted(...)`                                               | Called **after** a successful create, never before — a draft marked submitted for an order that never reached SAP is lost work.                                                                           |

## Rules worth knowing before changing this

- **The sold-to account is the security boundary.** SAP reads a sales order by VBELN alone, so the `order.kunnr !== session.kunnr` check in `getOrder`/`cancelOrder` _is_ the control, not a convenience. It answers 404, never 403 — the portal must not confirm another customer's order exists (CLAUDE.md rule 5).
- **A credit block is not an error.** SAP creates the order and holds it (docs/03 Module 4 flow), and so does the portal: `createOrder` succeeds, `creditStatus` comes back `CreditHold`, and the detail screen renders a prominent danger card. Never retry, hide, or re-submit around it.
- **ATP is advisory.** A partially-confirmed line is a date, not a refusal, so it does not block Submit. Only SAP's own validation does.
- **The form never sends a price.** VBAP-NETPR is pre-filled read-only only when an order comes from an accepted quotation (Phase 6). On a direct order SAP prices from its own condition records, so a browser-supplied price could only disagree with the invoice.
- **A draft validates against `salesOrderDraftSchema`, not `salesOrderWriteSchema`.** A draft that has to be complete before it can be saved is not a draft; the mandatory fields bite at submission.

## Errors

`OrderError` with codes `not_found` (404, also cross-account) · `invalid` (422, portal validation) · `rejected` (422, SAP refused the order itself) · `not_allowed` (409, too late for this action) · `no_account` (409) · `upstream_unavailable` (503). The raw SAP message is kept on `upstreamMessage` and deliberately **not** forwarded to customers by `apps/web/lib/portal-route.ts`.

## Cross-service work

Submitting from the cart touches three owners: SAP creates the order, this module records what the draft became, and `@cc/service-catalogue` empties the cart. Per ADR-011 that sequencing lives in the route handler (`apps/web/app/api/orders/route.ts`), not between services — and SAP goes first, because a cart cleared for an order that never reached SAP is lost work.

## Testing

```
pnpm --filter @cc/service-order test              # orders vs. the mock landscape; no database needed
pnpm --filter @cc/service-order test:integration  # draft -> submit flow; needs Postgres
```

The integration suite needs a database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```
