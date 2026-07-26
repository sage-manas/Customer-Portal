# Architecture Decision Records

ADR-style log for decisions made when a doc was ambiguous or silent. One entry per decision, newest first. Each decision follows the TRD's principles: contract-first, tenant-safe, mock-first.

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
