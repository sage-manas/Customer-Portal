# Architecture Decision Records

ADR-style log for decisions made when a doc was ambiguous or silent. One entry per decision, newest first. Each decision follows the TRD's principles: contract-first, tenant-safe, mock-first.

---

## ADR-023: Every cross-module effect goes through the outbox, written in the same transaction as the fact that caused it

**Context:** docs/07 A1 asks for an outbox table and a BullMQ relay, but leaves open how much may bypass it. From A2 onwards, modules need to cause effects in each other — a POD discrepancy raises a support ticket, a posted payment sends an email, an SLA timer breaches. The two obvious shortcuts are for a service to call another service directly (already forbidden: CLAUDE.md, ADR-011) or for a route handler to enqueue to BullMQ itself after its database write commits.

**Decision:** The queue is never written to from application code. A service records its effect by writing an `OutboxEvent` row **inside the same Prisma transaction as the state change that justifies it**, and the only process that publishes to BullMQ is the relay in `@cc/workers`. The event's name and payload shape come from the `DOMAIN_EVENTS` registry in `@cc/domain`, so an event is a declared contract with a Zod schema rather than a string and a `Json` blob. The relay is deliberately **at-least-once**: it claims a batch, publishes, then marks the rows published, and a crash between publish and mark republishes. Handlers are therefore required to be idempotent, and the queue job id is the outbox row id so BullMQ collapses the obvious duplicates on its own.

**Consequence:** The failure mode that makes async systems untrustworthy — the row committed but the event lost, or the event fired for a transaction that then rolled back — is structurally impossible, because there is exactly one commit. The price is latency (an event waits for the next relay tick, not the response) and the standing obligation that every handler be idempotent, which is the same discipline ADR-021 already imposes on payments and is enforced by the dedupe key rather than remembered. Choosing at-least-once over at-most-once is the deliberate half of that trade: a duplicated notification is an annoyance, a dropped dispatch event is a customer who was never told their goods shipped.

**Also decided here:** the dedupe key. `OutboxEvent` carries `@@unique([tenantId, dedupeKey])`, so a producer that runs twice (a retried webhook, a re-processed job) writes the same key and the second write is a no-op rather than a second event. It is the producer's key, not the consumer's — consumers still dedupe on their own terms.

---

## ADR-022: Workers are a new layer with their own edge, not code hidden inside a service

**Context:** docs/07 A1 introduces a background process and names the edge `workers -> services, adapters, db, domain, config`. That edge is unlike any existing one: `services` may not import `services` (ADR-011), yet a worker's whole job is to sequence work across modules — relay an event a delivery service wrote into a ticket the support service creates. Putting the worker inside a service package would have let it borrow that service's identity and quietly acquire an import it isn't allowed.

**Decision:** `packages/workers` (`@cc/workers`) becomes a seventh element type in `packages/config/eslint/base.js` with exactly that allow-list, and **nothing may import from `workers`** — the same rule `apps` has. Its handlers are the one place in the codebase permitted to touch two services in a single file, which is the worker equivalent of the role docs/DECISIONS ADR-011 gives to a route handler: the sequencer sits above the services, passes adapters in, and owns the ordering.

**Consequence:** The cross-module sequencing the remaining Track A phases need has a legal home, and it is a home the linter can see. Because nothing imports `workers`, the process can be deployed separately (its own container, its own scaling) without any package following it, and a route handler cannot start reaching into worker internals to "just run it inline" — which would put queue work back on the request path. The cost is one more layer to keep honest in the boundary rules, and the fact that `apps -> workers` being disallowed means the web app can never enqueue directly; it writes to the outbox, which is what ADR-023 wanted anyway.

---

## ADR-021: A payment's idempotency is enforced in three places, because one is not enough

**Context:** Doc 02 §6 asks for an "idempotent webhook design". Gateways deliver at least once, and the obvious reading is a single deduplication check — remember which event ids have been seen and drop repeats. The trouble is that a payment can be duplicated at three different moments by three different actors: the customer double-clicking Pay, the gateway redelivering a webhook, and the reconciliation job retrying a posting that timed out somewhere inside SAP.

**Decision:** Each moment gets its own key, all three enforced structurally rather than by a check the caller must remember. **Creating** the attempt is idempotent on the portal's payment id, which is passed to the gateway as its reference — a second `createOrder` for the same payment returns the first attempt. **Applying** a webhook is idempotent on the gateway's event id, held as a `UNIQUE (tenantId, lastEventId)` in Postgres, so a replay is recognised even if two workers race. **Posting** to SAP is idempotent on the gateway reference (BSEG-KIDNO), which `postIncomingPayment` already keys on, so a retried posting returns the original FI document rather than clearing the items twice.

**Consequence:** Every one of the three duplications a real gateway produces is a no-op instead of a second charge or a double clearing, and the integration suite exercises all three. The cost is three unique constraints and a slightly wordier service, which is a trivial price for the failure being prevented — a customer charged twice is the one defect in this module that cannot be fixed by re-reading SAP. It also means the webhook handler can safely answer 200 to a duplicate rather than erroring, which is what stops a gateway retry storm.

---

## ADR-020: Credit and debit notes are billing documents on the same type, shown on their own screen

**Context:** Doc 03 Screen 6.2 lists credit/debit notes with their own columns (FKART G2/L2, reason MGAGR, original invoice), and doc 05 §7.6 gives them a tab. In SAP they are VBRK rows like any invoice. So the portal had two choices: a separate `CreditDebitNote` entity with its own adapter method, or the existing `Invoice` type carrying the distinction.

**Decision:** They stay on `Invoice`, which grows `billingType` (FKART) and `reasonCode` (MGAGR), and `billingKind()` in `@cc/domain` classifies them. But they get their own _screen_ (`/invoices/notes`), and `listInvoices` excludes them by default. `isPayable()` refuses them outright.

**Consequence:** The adapter contract doesn't grow a method for something SAP returns from the read it already has, and one screen can render either kind — which is what the invoice detail page does for a note. Keeping them off the invoice list is the part that matters to a customer: a credit note has a negative amount, and a row of "-14,325.20" in a table of bills invites both a misread row and a misread total. The risk of the shared type is a screen that forgets to check the kind, which is why the check lives in three named domain functions rather than in an `if` per screen. An unknown FKART (a tenant's ZF2) classifies as an invoice rather than being dropped — a document the portal can't categorise still belongs on the customer's list.

---

## ADR-019: Payments are stored; every other O2C document is not

**Context:** ADR-016 established the rule for this whole phase of the build: SAP owns the document, so the portal does not mirror it — orders, deliveries and invoices are all re-read on every view and carry their freshness. Payments arrive looking like the same case. FI holds the posting; the statement can be re-read from BSID; storing a payment row invites exactly the stale mirror ADR-016 exists to prevent.

**Decision:** Payments are stored anyway, in `payments` + `payment_allocations`. The reason is a window that no other document has: between the gateway capturing money and SAP clearing the open items, there is a real debit against a real customer that **no FI document accounts for**. There is nothing in SAP to re-read, because the thing that happened hasn't reached SAP. So the portal keeps its own record, with `captured` and `posted` as separate states, and the statement renders un-posted payments as `Pending sync` (docs/05 §7.7) rather than pretending the balance already moved.

**Consequence:** A SAP outage between capture and posting costs the customer a delay, not their money: the payment sits `captured`, `listPendingSync` surfaces it, and reconciliation retries the posting (ADR-021 makes that safe). A payment is never rolled back from `captured` to `failed`, because that would tell a customer their money is safe when it isn't. The discipline ADR-016 asks for still holds everywhere it applies — the _statement_ is never read from these rows, only from BSID; the stored payment answers "what did we take?", never "what does the customer owe?". The two questions have different owners, and that is the whole distinction.

---

## ADR-018: AR arithmetic — aging, running balance, place of supply — is derived in the domain layer

**Context:** Phase 5 introduces four screens that each need a number computed from the same FI data: the invoice list (aging chip per row), the statement (running Debit/Credit/Balance), the AR summary (four aging buckets), and the dashboard KPI (pending invoices). Each could reasonably have computed its own, and the statement's running balance in particular reads like presentation.

**Decision:** All of it lives in `@cc/domain` (`entities/ar.ts`): `buildAging`, `buildStatement`, `invoiceTax`, and the due-date helpers. `AmountAging` in `@cc/ui` renders an `AgingSummary` and buckets nothing itself — the same rule `O2CTimeline` follows (ADR-015). Two judgements this forced into the open, where they can be tested: a filtered statement's **opening balance is the real balance carried into the range**, not zero, because a statement that starts from nothing is arithmetically tidy and financially wrong; and the aging bar covers the **whole ledger regardless of the date filter**, because a customer narrowing to last month is not asking for their account position to change.

**Consequence:** Two screens cannot disagree about what a customer owes, which for money matters more than it did for statuses. It also keeps the one thing the portal must never do — computing GST — structurally impossible to do by accident: `invoiceTax` only _reads_ which KONV conditions SAP populated to decide intra- vs inter-state, and derives the displayed rate from the amounts rather than a rate table, so a line-level mix or a cess still reports honestly (docs/02 §5).

---

## ADR-017: Cancelling an order is a new adapter method, not a portal-side status change

**Context:** Doc 05 §7.4 lists Cancel among an order's actions ("only while GBSTK=A, confirm dialog"), but the `SapAdapter` contract sketched in the TRD has no cancel operation — it covers create, simulate and read. The portal therefore had no way to express the action, and the tempting shortcut was to record the cancellation portal-side (a status column, a `cancelledAt`) and treat the SAP order as abandoned.

**Decision:** `cancelSalesOrder(vbeln, reason?)` joins the contract, implemented by the mock as SAP's own VA02 rejection (VBAP-ABGRU on every item): the order goes to `Closed`, nothing stays confirmed, the credit exposure it consumed is released, and its PO reference is freed so the customer may legitimately re-raise it. The ecc/s4 skeletons inherit the `not_implemented` throw like every other method (ADR-006). The service re-reads the order's status from SAP before calling it, so a screen minutes out of date cannot cancel an order that has since shipped.

**Consequence:** A cancelled order looks the same to the portal, to the tenant's back office and to SAP itself, because there is only one record of it. A portal-side flag would have produced an order that the customer believes is cancelled and that the warehouse still picks — the exact failure mode the mock-first contract exists to prevent. The cost is that Phase 7's ECC driver has one more BAPI to implement; that is a known, contract-tested cost rather than a hidden divergence.

---

## ADR-016: Submitted orders are never mirrored in the portal database; drafts are all that is stored

**Context:** `packages/db` has carried `SalesOrder` / `SalesOrderLine` tables since Phase 0, and doc 03 Screen 4.1 offers "Save Draft" alongside Submit. Once orders could actually be created, the tables invited the obvious use: write every submitted order to them, so the list and detail screens read from Postgres instead of paying a SAP round trip per view.

**Decision:** They are not. The tables hold **drafts** — half-filled forms with no VBELN, no ATP and no credit check, which SAP has no concept of — and, after submission, the row is kept solely as the record of which draft became which sales order. Every read of a submitted order (`listOrders`, `getOrder`) goes to `SapAdapter` and carries its freshness. The statuses stored on a submitted row are the ones SAP returned _at that moment_; nothing reads them back.

**Consequence:** An order's status is exactly what a customer refreshes to check, and it changes in SAP through picking, credit release and billing — none of which the portal observes. A mirror would be wrong within minutes and, worse, would be wrong _silently_, since a cached row carries no freshness. This is doc 05 P1 applied literally ("SAP is the truth; the UI is honest about it"). The cost is a SAP read per view, which is what the cache-aside layer in docs/02 §4.3 is for when it becomes one — a cache reports `cached` and the screen says so, which a mirror never would. Drafts are keyed to the sold-to account rather than the user, for the same reason the cart is (ADR-014).

---

## ADR-015: The O2C timeline is derived in the domain layer, not assembled per screen

**Context:** Doc 05 P4 makes the O2C chain "one continuous status timeline the user can traverse from any document", and §3.2 says `O2CTimeline` is "rendered on every document detail page". The component could reasonably have taken the raw documents (order, deliveries, invoices) and worked out the stages itself — it is the only thing that renders them.

**Decision:** `buildO2CTimeline(...)` lives in `@cc/domain` (`entities/o2c.ts`) alongside the `O2C_STAGES` registry, and returns `O2CStage[]` — status, date, document links and note per stage. The component renders that and decides nothing. Deriving is where the judgements live: a stage no document has reached is `null` ("Not started") rather than `Open`; a part-shipped order is `PartiallyDelivered` even when one of its deliveries says `Delivered`; payment is read off the invoices, because until Phase 5 the billing document's status is the only honest answer.

**Consequence:** The delivery and invoice detail screens in Phases 5–6 render the identical chain from the identical function, so two screens cannot disagree about whether an order shipped — which is precisely the failure a "spine" is supposed to prevent. It also makes the judgements testable without a DOM, and the Storybook stories build every state from real documents rather than from hand-written stage objects.

---

## ADR-014: The cart belongs to a sold-to account, and is repriced on every read

**Context:** Doc 05 §7.2 specifies a persistent cart drawer with line edit, MOQ/stock warnings and a split CTA, but says nothing about who owns a cart or how long a price in it survives. Both defaults are tempting and both are wrong: a per-user cart (the e-commerce norm) and a cart that stores the price the line was added at (the obvious way to avoid re-reading SAP).

**Decision:** The cart is keyed `(tenantId, customerKunnr)` — one basket per sold-to account, shared by every user acting for it — and stores only `material` + `quantity`. Price, stock, UoM, MOQ and the per-line issues are recomputed from `SapAdapter` on **every** read; nothing priced is persisted. `cart:manage` is a permission of its own, separate from `order:create`, so a buyer may stage a basket that a colleague converts.

**Consequence:** B2B purchasing is a team activity against a customer account, not a personal session, so the shared basket matches how the buying actually happens; the cost is that two colleagues can edit concurrently, which is acceptable because the last read is always authoritative. Repricing means a cart open across a price-list change shows the new price rather than a stale one — the alternative fails at order creation, where the customer has already committed. When SAP is unreachable, `getCart` returns `priced: false` with null prices instead of failing (docs/05 P7), so Request Quote still works while Create Order is gated.

---

## ADR-013: Catalogue prices and stock are read per card, not per page

**Context:** Doc 05 §7.2 says "price and stock lazily loaded per card with skeletons (they're per-customer SAP calls)". The simpler implementation is to compose the whole grid on the server — one page render, no client fetching — which is how every other Phase 0–2 screen works.

**Decision:** The material list is read on the server, and each card fetches its own price and stock from `/api/catalogue/materials/[material]/availability` after mount. `getMaterialAvailability` is the service entry point for exactly one material, and the browse read deliberately carries no pricing.

**Consequence:** A slow or missing condition record delays its own card rather than the grid, and the skeleton states doc 05 requires are real rather than decorative. It costs N requests per page (24 at the current page size), which is the trade the doc asks for; if it becomes a problem the fix is a batch endpoint over the same service function, not moving pricing back into the browse read. `getPriceList` does price everything at once — it is a table the customer asked for in full, not a grid they are scanning.

---

## ADR-012: Object storage is an adapter, and uploaded documents are streamed through a route handler

**Context:** Phase 2 introduces file uploads (PAN copy, GST certificate, incorporation certificate). Doc 03 Screen 1.4 says they are "stored in portal object storage; attached to SAP customer via GOS post-creation", but object storage is not on doc 06's adapter list (`gstn`, `einvoice`, `eway`, `payment-gateway`, `notifications`), so it would have been easy to write bytes to disk from inside the onboarding service.

**Decision:** Object storage is an external system like any other, so it gets `packages/adapters/storage` with an `ObjectStorage` contract, two mock drivers (`memory` for tests/CI, `local` for the dev server so uploads survive a hot reload) and an `s3` skeleton that throws `not_implemented`. Documents are **never** exposed by storage key: `/api/admin/onboarding/[id]/documents/[kind]` re-checks the session, the permission and the tenant on every read and streams the bytes itself.

**Consequence:** Isolation for a shared store comes from the caller's key prefix (`<tenantId>/onboarding/<applicationId>/<kind>`) plus the tenant-scoped DB row that references it; the `local` driver additionally refuses any key resolving outside its root. Signed direct-to-bucket URLs are deliberately not used yet — they move the authorization check to the moment a link is minted rather than the moment it is used, which is the wrong trade for statutory documents.

---

## ADR-011: Cross-service orchestration happens in the route handler, not between services

**Context:** Approving an application does three things: create the customer in SAP, record the decision, and issue portal credentials. Per-tenant SAP resolution lives in `@cc/service-sap`, and password hashing lives in `@cc/service-identity` (ADR-008) — but `services -> services` is not an allowed dependency edge (ADR-004), so `@cc/service-onboarding` can import neither.

**Decision:** `approveApplication(tenantId, id, decision, sap)` takes the `SapAdapter` as a parameter — the pattern `getDashboardSummary(adapter, kunnr)` already established in Phase 1 — and returns `{ application, kunnr, contactEmail, legalEntityName }`. The route handler at `/api/admin/onboarding/[id]/approve` resolves the adapter from `@cc/service-sap`, calls onboarding, and then calls `provisionPortalAccess` from `@cc/service-identity`. GSTN and object storage, which no other module owns, _are_ resolved inside the onboarding service.

**Consequence:** The sequencing is visible where it matters — credentials are only issued after SAP has accepted the customer, never before — and no service grows a dependency on another. The cost is that the handler is slightly thicker than a pure delegation; that is accepted, because the alternative is either duplicating the SAP resolver or breaking the boundary rule. If a third caller ever needs the same sequence, it moves into a `packages/services/orchestration` module rather than into either service.

---

## ADR-010: GSTN verification is stored as evidence, and only a state mismatch blocks the applicant

**Context:** Doc 05 §7.1 requires a live GSTN verify on step 2 with "spinner → verified tick with legal name echo → mismatch warning", and says the result "must match Step-1 state code; mismatch blocks continue with explanation". It does not say what the reviewer sees later, or what happens when GSTN itself is down.

**Decision:** Each verification attempt is persisted on the application as `GstinVerification` — the answer, the legal name GSTN returned, the taxpayer status, and `checkedAt` — and the approval screen renders _that_, rather than re-verifying. Outcomes are explicit (`verified` · `mismatch` · `inactive` · `not_found` · `invalid` · `unavailable`), and only the first four block submission: `unavailable` lets the application through to review, per doc 05 P7 ("the portal never hard-fails because SAP is down" — the same holds for GSTN). Changing the GSTIN discards the stored verification, because evidence belongs to a specific number. A legal-name mismatch is a warning, not a block: GSTN's registered name legitimately differs from a trading name.

**Consequence:** The reviewer sees what was actually checked and when, instead of a boolean, and an application submitted during a GSTN outage is visibly unverified rather than silently trusted. The mock driver therefore never echoes the applicant's own input back as the legal name — a mock that did would make the mismatch state untestable.

---

## ADR-009: Applicants hold a draft token, not a session

**Context:** The onboarding wizard is explicitly pre-auth (doc 05 §7.1: "public, pre-auth beyond email verification") and the applicant has no portal user until approval creates one — yet the wizard is a multi-request, resumable, autosaving flow over PAN, GSTIN and bank details, so "public" cannot mean "unaddressed".

**Decision:** `startApplication` mints a 32-byte random draft token, stored on the application row; every applicant-facing operation takes `{ applicationId, draftToken }` and compares the token in constant time, treating a mismatch as **404**. The tenant still comes from the host and every query still runs inside `runWithTenant`, so the token narrows _within_ a tenant and never across one. The token is kept in `localStorage` and sent as `x-draft-token` — never in the URL, where it would leak through the address bar, `Referer`, bookmarks and shared links. `toApplication` never carries it, so it cannot escape through a reviewer's screen.

**Consequence:** An applicant can resume only on the device they started on, which is why `/register/status` says so plainly rather than showing an empty state. Email-verification links (which would make the token portable) arrive with the notifications adapter in Phase 6. `/api/onboarding/*` is in the middleware's public list; `/api/admin/onboarding/*` deliberately is not.

---

## ADR-008: Dev seed lives in `@cc/service-identity`, not `@cc/db`

**Context:** The conventional home for a Prisma seed is `packages/db/prisma/seed.ts`. But the seed has to create users _with credentials_, and the password-hash format (`scrypt$N$r$p$salt$hash`) is owned by `@cc/service-identity`. `db` may only import `domain` + `config` (ADR-004), so `@cc/db` cannot import the hashing function — and hand-copying the format into the seed is exactly the duplication CLAUDE.md rule 3 forbids.

**Decision:** The seed lives at `packages/services/identity/scripts/seed.ts` and runs via `pnpm --filter @cc/service-identity db:seed` (tsx). It is a `services` element, so importing both `@cc/db` and the hashing code is within the dependency rule. It seeds two tenants (`acme`, `globex`) on the mock driver, with users across every role family linked to the KUNNRs the mock SAP adapter seeds, and it performs every write inside `runWithTenant` — the seed gets no privileged path around tenant scoping.

**Consequence:** Two tenants, not one, is deliberate: cross-tenant isolation is only demonstrable when a second tenant's data exists to fail to reach. If a future seed needs data from several service packages, it moves to a dedicated `packages/services/seed` package rather than back into `db`.

---

## ADR-007: SAP reads carry their own freshness; writes do not

**Context:** Doc 05 P1 ("SAP is the truth; the UI is honest about it"), §6.1 and §12 require every screen to declare and display a freshness class — `Live`, `Synced <time>`, or a stale banner — and `SapSyncIndicator` renders it. The TRD §4.1 sketch of `SapAdapter`, however, returns bare domain objects, which leaves each screen to decide for itself how fresh its data is. Screens guessing their own freshness is precisely how a portal ends up claiming "Live" over a two-hour-old cache.

**Decision:** Every read on `SapAdapter` returns `SapRead<T> = { data, freshness, syncedAt }`; writes return plain results. A driver reports `live` for a call it actually made and `stale` for a degraded answer served while SAP was unreachable; the cache-aside layer (docs/02 §4.3) sets `cached`. Composed reads take the least-fresh part (see `getDashboardSummary`).

**Consequence:** Consumers unwrap `.data`, which is slightly more verbose than the TRD sketch — accepted, because the freshness contract is then impossible to forget. `FreshnessClass` is re-exported from `@cc/service-sap` so app code can render it without importing the adapters layer.

---

## ADR-006: Real SAP drivers fail loudly rather than falling back to the mock

**Context:** A tenant configured for `ecc`/`s4` before those drivers exist (Phase 7) has to do _something_. The convenient option is for the factory to fall back to the mock driver so the app keeps working.

**Decision:** It does not. `EccSapAdapter`/`S4SapAdapter` extend a shared skeleton whose every method throws a typed `not_implemented` `SapError`, and the factory refuses to construct them without connection settings. A mis-configured tenant fails at the call site with a translatable error.

**Consequence:** Serving fabricated material prices, stock and credit limits to a real customer as if they were their own SAP data would be far worse than an error page — a mock fallback in production is indistinguishable from working software until someone acts on the numbers. The skeleton also gives Phase 7 a method-by-method migration path with the contract test-suite unchanged.

---

## ADR-005: Phase 1 adds two service packages — `identity` and `sap`

**Context:** `packages/services/README.md` (Phase 0) said the first service arrives in Phase 2 with the Onboarding module. But Phase 1's scope — "auth (credentials → JWT with tenant/customer/roles claims), RBAC middleware, app shell" — is business logic that cannot live in `apps/web` without breaking ADR-002 (route handlers are thin adapters over a framework-free service layer). Separately, the dashboard needs SAP data, and `apps -> adapters` is not an allowed dependency edge, so the app cannot call the adapter factory itself.

**Decision:** Create `@cc/service-identity` (login, tokens, tenant resolution, RBAC guards) and `@cc/service-sap` (per-tenant adapter resolution + the dashboard summary read) in Phase 1. `@cc/service-identity` ships a second entry point, `@cc/service-identity/edge`, containing only the pure/WebCrypto parts — Next middleware runs on the edge runtime where Prisma cannot load, and a route guard that can't run in the guard's runtime is not a guard.

**Consequence:** `@cc/service-sap` currently holds `getDashboardSummary`, which is really reporting logic; it moves to `packages/services/reporting` in Phase 6, and its return shape is the contract so the page won't change. The module services (`onboarding/`, `catalogue/`, …) still start in their own phases as planned.

---

## ADR-004: `packages/config` is importable from every layer, including at runtime

**Context:** Doc 06's dependency rule enumerates `ui -> domain`, `services -> domain + adapters + db`, `apps -> ui + services + domain`, `domain -> nothing`, `adapters -> domain` (never services) — but never mentions `config` as a source or target. Doc 06 also explicitly assigns `packages/config` "eslint, tsconfig, tailwind preset, **shared constants**." The first `packages/ui` domain component (`Money`) needs `LOCALE`/`CURRENCY_SYMBOL` from those shared constants, which the literal dependency-rule enumeration would block.

**Decision:** Treat `config` as available to every layer (`domain`, `ui`, `services`, `adapters`, `db`, `apps`), including at runtime, not just for build tooling — it has zero dependencies of its own (`config -> []`), so allowing it everywhere cannot introduce a cycle or leak a layer's internals upward. The `eslint-plugin-boundaries` rule set in `packages/config/eslint/base.js` reflects this: every element type's allow-list includes `config`.

**Consequence:** Only genuinely cross-cutting, dependency-free values belong in `packages/config/src/constants.ts` (locale, currency, timezone, fiscal-year start). Anything tied to a business entity, SAP field, or status code still belongs in `packages/domain`, not here — `config` stays a leaf.

---

## ADR-003: Phase 0 tenancy is row-level `tenantId` + Prisma middleware, not schema-per-tenant

**Context:** Doc 02 (TRD §2, §11) leaves "schema-per-tenant vs. RLS default tier" as an explicit open technical decision, offering schema-per-tenant for the enterprise tier and row-level `tenant_id` + RLS for smaller tenants. Doc 06 (kickoff prompt), however, is concrete about the Phase 0 mechanism: "every DB query runs through tenant-scoped Prisma middleware; tenant resolved from subdomain + JWT claim; a query without tenant context must throw" — this describes the row-level model, not schema switching.

**Decision:** Implement single-schema, row-level `tenantId` isolation for Phase 0: every tenant-owned table carries a `tenantId` column, an `AsyncLocalStorage`-backed tenant context (`packages/db/src/tenant-context.ts`) is required before any query, and a Prisma Client Extension (`packages/db/src/tenant-middleware.ts`) auto-injects/enforces `tenantId` on every operation against a tenant-scoped model — throwing if no tenant context is bound. Cross-tenant isolation tests run against this model in CI.

**Consequence:** Schema-per-tenant for the enterprise tier remains open per TRD §11 and is deferred until a tenant's compliance requirements demand it (matches the roadmap's "revisit Kubernetes/VPC peering when a tenant demands it" posture). Migrating a specific tenant to its own schema later is additive, not a rewrite, since the Prisma models and the `SapAdapter`-facing service layer don't change.

---

## ADR-002: Backend runtime is Next.js route handlers, not a separate NestJS service (Phase 0)

**Context:** Doc 02 (TRD §8) recommends Node.js + NestJS as the backend. Doc 06 (kickoff prompt) supersedes this with "Next.js route handlers for the BFF now, structured so the service layer can later move behind NestJS/Fastify without rewriting business logic."

**Decision:** Follow doc 06 — it is the most recent and most specific instruction, and it is explicitly framed as a non-negotiable decision. `packages/services/*` contains framework-free business logic (typed service interfaces, no Next.js imports); `apps/web/app/api/*` (or route handlers) are thin adapters that call into `packages/services`. This keeps the NestJS migration path doc 06 describes open without a rewrite.

**Consequence:** Do not add NestJS scaffolding in Phase 0. Revisit only if/when a standalone backend process is needed (per TRD §8 PaaS caveats around `node-rfc`).

---

## ADR-001: Docs live under `/docs/`, not the repo root

**Context:** Doc 06 (kickoff prompt) instructs reading `/docs/00-PORTAL-OVERVIEW.md` etc., but the six planning docs were originally created at the repo root.

**Decision:** Move all planning docs (`00-PORTAL-OVERVIEW.md` … `06-CLAUDE-CODE-KICKOFF-PROMPT.md`) into `/docs/` so paths referenced throughout doc 06 resolve correctly, and so the repo root stays reserved for monorepo tooling config (`package.json`, `turbo.json`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md`).

**Consequence:** Any future doc additions (e.g., new ADRs, module specs) also go in `/docs/`.
