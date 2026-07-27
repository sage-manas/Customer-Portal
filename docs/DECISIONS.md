# Architecture Decision Records

ADR-style log for decisions made when a doc was ambiguous or silent. One entry per decision, newest first. Each decision follows the TRD's principles: contract-first, tenant-safe, mock-first.

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
