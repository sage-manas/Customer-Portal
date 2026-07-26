# 02 — Technical Requirements Document (TRD) & Architecture

## Multi-Tenant SAP-Integrated B2B Customer Portal SaaS

Version 1.0 · 2026-07-25 · Companion to 01-PRD.md

---

## 1. Architecture Overview

Three planes:

```
┌────────────────────────── PLATFORM PLANE (us) ──────────────────────────┐
│ Operator console · Tenant provisioning · Metering/Billing · Monitoring  │
└─────────────────────────────────────────────────────────────────────────┘
┌────────────────────────── APPLICATION PLANE ────────────────────────────┐
│  Web app (customer portal + tenant back-office)  ← API Gateway          │
│  Services: Identity/RBAC · Onboarding · Catalogue · Order · Delivery    │
│            Billing/Invoice · Payment · Support · Loyalty · Reporting    │
│            Notification · Document/File · Workflow engine · Audit       │
│  Async backbone: message queue + outbox · Cache (Redis)                 │
└─────────────────────────────────────────────────────────────────────────┘
┌────────────────────────── INTEGRATION PLANE ────────────────────────────┐
│  SAP Adapter Layer (per tenant):                                        │
│    • ECC driver: RFC/BAPI (SAP JCo / NW RFC), IDoc listener optional    │
│    • S/4 driver: OData v2/v4 APIs (API_SALES_ORDER_SRV, etc.)           │
│    • Mock driver: full simulation for dev/demo/trials                   │
│  Connectivity: site-to-site VPN, SAP Cloud Connector, or on-prem agent  │
│  External: GSP (GSTN/e-invoice/e-way) · Payment gateways · Email/SMS/WA │
└─────────────────────────────────────────────────────────────────────────┘
```

**Style:** modular monolith first (single deployable, clear module boundaries), extract services only when scale demands. Avoid premature microservices.

## 2. Multi-Tenancy Design

- **Isolation model:** shared application, **PostgreSQL with one schema per tenant** (or row-level `tenant_id` + RLS for small tenants; schema-per-tenant for enterprise tier). Tenant resolution from subdomain/custom domain + JWT claim; every query scoped by middleware — no query executes without tenant context.
- **Tenant config store:** branding, module toggles, field-mapping overrides, workflow definitions, SAP/GSP/gateway credentials (encrypted with per-tenant data key via KMS envelope encryption).
- **Noisy-neighbor control:** per-tenant rate limits at gateway; per-tenant queue partitions for SAP calls.
- **Custom domains:** CNAME + automated TLS (ACME).
- **Isolation testing:** automated cross-tenant access tests in CI (attempt access with wrong tenant token must 404/403).

## 3. Identity & Access

- OIDC-based auth service (Keycloak or Auth0/Cognito). Separate realms/user pools per plane; end-customer users belong to (tenant, customer-account) pairs — one user may act for multiple ship-to/sold-to accounts.
- RBAC: platform roles (operator), tenant roles (admin, sales, credit, support), customer roles (buyer admin, buyer user, view-only). Permission checks at API layer, not UI.
- MFA optional per tenant policy; SSO (SAML/OIDC) for tenant internal users (P1).
- Session: short-lived access JWT + refresh; tenant_id, customer_id (KUNNR), roles as claims.

## 4. SAP Adapter Layer (the core technical asset)

### 4.1 Contract-first design

Define a canonical domain API the app consumes; each driver implements it:

```
interface SapAdapter {
  createCustomer(CanonicalCustomer): CustomerResult      // ECC: BAPI_CUSTOMER_CREATEFROMDATA1 · S/4: BP API
  getMaterials(query), getStock(matnr, plant)            // MARA/MARD · API_PRODUCT_SRV / ATP API
  getCustomerPrice(kunnr, matnr, qty)                    // pricing simulation (order simulate) or VK13 reads
  createInquiry(...), createQuotation(...), convertQuoteToOrder(...)
  createSalesOrder(...) / simulateOrder(...)             // BAPI_SALESORDER_CREATEFROMDAT2 + SIMULATE · API_SALES_ORDER_SRV
  getOrderStatus(vbeln), getDeliveries(vbeln), getDeliveryDetail(...)
  getInvoices(kunnr), getInvoicePdf(vbeln)
  getOpenItems(kunnr), postIncomingPayment(...)          // BAPI_AR_ACC_GETOPENITEMS · F-28 equivalent posting
  getCreditInfo(kunnr)                                   // KNKK / credit mgmt API
}
```

### 4.2 Field mapping engine

- Default mappings ship from the functional spec (doc 03: KNA1/KNVV/VBAK/VBAP/LIKP/VBRK/BSID...).
- Per-tenant overrides via config (JSON/YAML): custom Z-fields, value maps (e.g., account groups, order types, tax codes), mandatory-field rules.
- Validation layer enforces SAP data types/lengths (CHAR/NUMC/DATS/CURR/QUAN) before calling SAP — reject early with friendly errors.

### 4.3 Sync patterns

- **Reads:** cache-aside with per-entity TTLs (catalogue 15–60 min; stock 1–5 min or real-time ATP on order; invoices/statement on-demand + short cache).
- **Writes:** transactional outbox → queue → adapter worker → SAP; idempotency keys (portal doc UUID stored in SAP reference fields e.g. BSTNK/KIDNO); retry with backoff; dead-letter queue + ops alerting; user sees "Submitted → Confirmed (SO #)" state machine.
- **Change capture from SAP:** poll deltas (change dates) at MVP; IDoc/event-mesh push (S/4 business events) later.
- **Resilience:** circuit breaker per tenant connection; degrade to cached data with staleness banner.

### 4.4 Connectivity options per tenant

1. Site-to-site VPN to tenant network (ECC on-prem).
2. SAP Cloud Connector / BTP destination (S/4 or hybrid).
3. Lightweight **on-prem connector agent** (outbound-only WebSocket/gRPC to platform) — best security story; recommended default.

## 5. India Compliance Services

- **GSP integration service** (abstraction over ClearTax/Masters India/etc. — pluggable): GSTIN verification (onboarding), e-invoice IRN fetch/display, e-way bill fetch/display. Note: IRN/e-way are usually generated by the tenant's SAP GST solution; portal primarily **displays/downloads**; direct generation is a tenant-configurable option.
- **Tax display logic:** intra-state (CGST+SGST) vs. inter-state (IGST) derived from REGIO/place-of-supply data returned by SAP pricing — portal never computes tax itself.
- **Document retention:** invoices/e-invoices immutable in object storage, 7-year retention, WORM-style bucket policy.

## 6. Payments

- Gateway abstraction (Razorpay first): create payment against selected open items; webhook (signed, idempotent) → payment record → outbox → SAP incoming-payment posting with clearing of chosen items; partial payment supported (residual open item).
- Reconciliation job: gateway settlements vs. SAP postings; exception queue for ops.
- PCI: never touch card data — hosted checkout only.

## 7. Data Model (core entities, portal-side)

`tenants, tenant_configs, sap_connections, users, roles, user_account_links(customer KUNNR), onboarding_applications(+documents, approvals), products_cache, price_cache, carts, orders(portal state + sap_vbeln), order_events, deliveries_cache, invoices_cache, payments, payment_allocations, tickets(+sla_events), notifications, audit_log, sync_jobs, webhooks`.

Portal state vs. SAP mirror: business documents live in SAP; portal keeps a **thin mirror + portal-only state** (drafts, workflow states, attachments) — never fork the source of truth.

## 8. Technology Stack (recommended)

| Layer            | Choice                                                                                                                                                                                                                                                               | Rationale                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Frontend         | React + TypeScript, Next.js, Tailwind                                                                                                                                                                                                                                | Talent pool, SSR for custom domains                                                             |
| Backend          | **Node.js + NestJS (TypeScript)**                                                                                                                                                                                                                                    | Single language across stack; NestJS gives modules/DI/guards that map cleanly to tenancy + RBAC |
| SAP connectivity | `node-rfc` (SAP NW RFC SDK) for ECC BAPIs; plain HTTP OData clients for S/4. If `node-rfc` proves brittle on the PaaS, isolate RFC calls in the **on-prem connector agent** (also Node) running inside the tenant network — the platform then only speaks HTTPS/gRPC | Keeps everything TypeScript; RFC native deps stay off the PaaS                                  |
| DB               | PostgreSQL (managed, e.g. Neon/RDS/Azure Flexible Server; schema-per-tenant), Redis (managed)                                                                                                                                                                        | Isolation + cache                                                                               |
| Queue            | BullMQ (Redis-backed) at MVP; move to RabbitMQ/Kafka if volume demands                                                                                                                                                                                               | No extra infra to run on a PaaS                                                                 |
| ORM              | Prisma or Drizzle with tenant-schema switching middleware                                                                                                                                                                                                            | Type-safe, migration tooling                                                                    |
| Storage          | S3-compatible (India region)                                                                                                                                                                                                                                         | Documents, invoices                                                                             |
| Infra            | **Managed PaaS** (Render / Railway / Azure App Service / AWS App Runner) in an India region for data residency; defer Kubernetes until scale or tenant compliance demands it                                                                                         | Minimal DevOps overhead pre-GA                                                                  |
| IaC/CI           | GitHub Actions; light IaC (Pulumi TS or provider config-as-code)                                                                                                                                                                                                     | Same language, repeatable envs                                                                  |
| Observability    | OpenTelemetry → hosted backend (Grafana Cloud / Axiom / Datadog)                                                                                                                                                                                                     | Per-tenant dashboards without self-hosting                                                      |
| Auth             | Auth0 / Clerk (multi-tenant orgs) — or self-hosted Keycloak later if cost bites                                                                                                                                                                                      | Managed fits the PaaS-first approach                                                            |

**PaaS caveats to plan for:** (1) `node-rfc` needs the proprietary SAP NW RFC SDK binary — often awkward on managed PaaS; the on-prem connector agent pattern (TRD §4.4) sidesteps this entirely and is the recommended default. (2) Site-to-site VPN to tenant networks is hard on most PaaS — another reason the outbound-only connector agent is the right choice. (3) Revisit Kubernetes when a tenant demands VPC peering, private networking, or compliance attestations the PaaS can't provide.

## 9. Security Requirements

- TLS 1.2+ everywhere; AES-256 at rest; per-tenant KMS data keys for credentials.
- Least-privilege SAP service users per tenant (only required BAPIs/services authorized — provide an SAP authorization role template `Z_PORTAL_RFC` to tenants).
- OWASP ASVS L2; dependency scanning; pen test before GA; secrets in vault (no env-file secrets in prod).
- Rate limiting, WAF, bot protection on public registration.
- Immutable audit log (append-only) for all writes and permission changes.
- DPDP Act: consent capture at registration, data-subject deletion workflow (anonymize portal data; SAP retention governed by tenant), India data residency.

## 10. Environments & DevOps

- Envs: dev (mock adapter), QA (mock + one shared SAP sandbox), staging (pilot tenant SAP), prod.
- CI: unit + contract tests against mock adapter; adapter contract test-suite runs against real SAP nightly in QA.
- Blue/green or rolling deploys; DB migrations per-tenant-schema orchestrated (e.g., Flyway loop) with canary tenant.
- Backups: PITR for Postgres; DR: cross-AZ active, cross-region passive (RPO 15 min, RTO 4 h).

## 11. Open Technical Decisions

1. RFC path: `node-rfc` in-platform vs. on-prem connector agent only (recommend agent-only; keeps PaaS clean).
2. Schema-per-tenant vs. RLS default tier.
3. GSP vendor selection.
4. Workflow engine: build simple state machines vs. embed Temporal/Camunda (recommend simple first; Temporal when workflows multiply).
5. Real-time ATP vs. cached stock per tenant tier.
