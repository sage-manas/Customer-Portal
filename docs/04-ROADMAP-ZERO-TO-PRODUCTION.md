# 04 — Roadmap & Zero-to-Production Plan

Version 1.0 · 2026-07-25

## Phase 0 — Validation & Foundation (Weeks 1–6)

- Interview 8–10 prospective tenants; sign **2 design partners** (discounted lifetime pricing in exchange for SAP access + feedback). This is the single biggest de-risker.
- Freeze MVP scope (P0 set from PRD §5); write API contracts for the SAP adapter (TRD §4.1).
- Stack decided: NestJS + Next.js (TypeScript), PostgreSQL on managed PaaS, on-prem connector agent for SAP RFC. Remaining: GSP vendor, gateway (Razorpay).
- Set up repo, CI/CD, IaC, environments; **build the mock SAP adapter first** — the entire team develops against it without waiting for SAP access.
- Fresh UX design system (do NOT reuse reference UI): design Onboarding, Catalogue, Order, Invoice, Payment flows; usability-test with design partners' actual dealers.

Exit criteria: signed design partners, frozen MVP scope, adapter contract + mock working, designs approved.

## Phase 1 — Platform Core (Weeks 5–14, overlaps)

- Tenancy foundation: tenant provisioning, subdomain/custom-domain, schema-per-tenant migrations, tenant-scoped middleware + isolation tests in CI.
- Auth/RBAC (Keycloak realms), user–customer-account linking.
- Config store + credential vault (KMS envelope).
- Notification engine (email + in-app), document service (S3), audit log, outbox + queue workers.
- Skeleton tenant admin console + platform operator console.

## Phase 2 — MVP Modules (Weeks 12–28)

Build against mock adapter; integrate real SAP as drivers mature.

1. Onboarding (wizard + GSTIN validation + approval workflow + SAP customer create).
2. Catalogue (sync jobs, pricing, stock cache).
3. Orders (create/simulate/status, credit-check surfacing).
4. Delivery tracking + POD.
5. Invoices (list/PDF/IRN display) + Statement.
6. Payments (Razorpay + webhook + SAP posting + reconciliation).

In parallel: **ECC RFC driver** (design partner #1's landscape first). Contract test-suite runs nightly against partner sandbox.

## Phase 3 — Pilot (Weeks 26–38)

- Deploy design partner #1 to staging→prod; onboard 10–20 of their real dealers; run real orders end-to-end.
- Weekly feedback loop; fix mapping/edge cases (Z-fields will surface here — expand mapping engine).
- Add design partner #2 (ideally different SAP flavor → validates adapter abstraction; build S/4 OData driver if applicable).
- Measure: order success rate, sync failure rate, dealer adoption, time-to-onboard.

## Phase 4 — Hardening & GA (Weeks 36–48)

- Security: pen test, OWASP ASVS L2 audit, cross-tenant isolation audit, DPDP review.
- Reliability: load tests (50K orders/day target), chaos tests on SAP-down scenarios, DR drill.
- Operations: runbooks, on-call, per-tenant health dashboards, SLA definitions (99.9%), status page.
- Commercial: pricing tiers (e.g., per-module + per-active-dealer bands), subscription billing, MSA/DPA templates, tenant onboarding playbook (target < 4 weeks go-live).
- GA launch; sales motion via SAP-partner SIs as channel.

## Phase 5 — R2/R3 (post-GA)

R2: Inquiry/Quotation, Support+SLA, Reports, SSO, WhatsApp notifications, second SAP driver GA. R3: Loyalty/rebates, scheduled reports, Hindi/regional, extension marketplace.

## Team (lean MVP shape)

1 product (you) · 1 tech lead/architect (TypeScript/NestJS) · 2 backend (TS) · 1–2 frontend (Next.js) · 1 SAP integration specialist (critical hire — BAPI/OData experience; owns the connector agent) · 1 QA/SDET · fractional DevOps + designer. ~7–9 people. Single-language stack lets backend/frontend flex across the boundary.

## Budget signals (rough)

- Team 9–12 months: dominant cost.
- Infra pre-GA: modest ($1–3K/mo); GSP + tooling minor.
- SAP test environment: use design partners' sandboxes + SAP CAL/community licenses for dev.

## Top 5 execution risks & the mitigation already baked in

1. **No SAP access early** → mock adapter first (Phase 0).
2. **Every tenant's SAP is different** → mapping engine + config overrides; pilot with two different landscapes before GA.
3. **Building all 10 modules before selling** → MVP is 6 modules; sell on the O2C core.
4. **Tenant isolation defect** → isolation tests in CI + external audit before GA.
5. **Payment/SAP posting mismatch** → idempotent webhook design + daily reconciliation job + exception queue from day one.

## Definition of "production grade" (GA checklist)

- [ ] 99.9% uptime over 60 days in pilot
- [ ] < 0.5% SAP sync failure (with auto-retry)
- [ ] Pen test passed, findings remediated
- [ ] Cross-tenant isolation audit passed
- [ ] DR drill: RPO 15 min / RTO 4 h demonstrated
- [ ] Runbooks + on-call live; status page public
- [ ] 2 reference tenants in production with real order volume
- [ ] Billing, MSA/DPA, support SLAs operational
