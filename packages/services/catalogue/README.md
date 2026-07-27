# @cc/service-catalogue

Product catalogue and cart (docs/03 Module 2, docs/05 §7.2) — Phase 3.

Framework-free, like every `packages/services` module: no Next.js imports, every DB call inside `runWithTenant`, typed errors that route handlers map to status codes.

## Two halves, two storage models

- **Catalogue** is SAP master data, so **nothing is stored**. `browseCatalogue`, `getMaterialAvailability`, `getProductDetail` and `getPriceList` compose `SapAdapter` reads and carry their freshness with them (ADR-007) — a composed read takes its least-fresh part.
- **Cart** is the one thing SAP does not own, so it _is_ stored (`Cart` / `CartLine` in `@cc/db`). What is **not** stored is price and stock: every read reprices through the adapter, because a cart showing the price it was added at would quietly mis-state the order value at checkout.

## Public API

| Function                                                  | Notes                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `browseCatalogue(sap, query?)`                            | MARA/MAKT page with MATKL/WERKS/search filters.                                                            |
| `getMaterialAvailability(sap, kunnr, material, options?)` | The **lazy per-card** read: customer price + stock for one material (docs/05 §7.2 requires per-card load). |
| `getProductDetail(sap, kunnr, material, quantity?)`       | Material master + plant-wise stock (highest first) + price, priced at the MOQ by default.                  |
| `getPriceList(sap, kunnr, query?)`                        | Screen 2.2: KNUMH, DATAB–DATBI, K007 discount. Unpriced materials stay in the list as "on request".        |
| `getCart(tenantId, kunnr, sap)`                           | Reprices on every read.                                                                                    |
| `addToCart(tenantId, kunnr, input, sap)`                  | Verifies the material against SAP first; adding an existing material increases its quantity.               |
| `updateCartLine` / `removeCartLine` / `clearCart`         | Scoped by the session's own cart — another account's line id is a 404.                                     |
| `getCartLineCount(tenantId, kunnr)`                       | For the top-bar badge, so rendering the shell doesn't pay for a repricing.                                 |

## Rules worth knowing before changing this

- **A missing condition record is not an error.** A material with no PR00 is a real, browsable product that can't be priced online — doc 03 Screen 2.1 pairs every card with "Request Quote" for exactly that. Pricing degrades to `null` plus a reason; only a genuine outage throws.
- **The cart survives a SAP outage.** `getCart` returns `priced: false` with null prices rather than 503-ing (docs/05 P7: the portal never hard-fails because SAP is down). The Create Order CTA is gated on `priced`; Request Quote is not.
- **MOQ is checked three times** — the stepper (courtesy), `issuesFor` here (the control), and SAP at VA01 (the truth). Only the middle one is load-bearing for the API.
- **`stockAvailability()` lives in `@cc/domain`**, not here and not in the chip. One definition of "low" for the service, the card, the drawer and the plant table.
- **The cart belongs to a KUNNR, not a user.** Colleagues on the same sold-to account share one basket, which is why the unique key is `(tenantId, customerKunnr)`.

## Errors

`CatalogueError` with codes `not_found` (404, also for cross-account) · `invalid` (422) · `not_orderable` (422) · `no_account` (409) · `upstream_unavailable` (503). The raw SAP message is kept on `upstreamMessage` and deliberately **not** forwarded to customers by `apps/web/lib/portal-route.ts`.

## Testing

```
pnpm --filter @cc/service-catalogue test              # catalogue reads vs. the mock landscape
pnpm --filter @cc/service-catalogue test:integration  # cart flow; needs Postgres
```

The integration suite needs a database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```
