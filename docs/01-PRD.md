# 01 — Product Requirements Document (PRD)

## Multi-Tenant SAP-Integrated B2B Customer Portal SaaS ("CustomerConnect" — working name)

|         |             |
| ------- | ----------- |
| Version | 1.0 (Draft) |
| Owner   | Manas Singh |
| Date    | 2026-07-25  |
| Status  | For review  |

---

## 1. Problem Statement

Indian mid-market and enterprise manufacturers/distributors running SAP (ECC or S/4HANA) handle customer orders through phone/email/WhatsApp and manual SAP data entry. This causes order errors, slow quote turnaround, opaque delivery status, delayed collections, and heavy sales-coordination overhead. Existing options are either expensive custom Fiori/portal builds (₹50L–₹2Cr, 9–18 months each) or generic B2B commerce platforms with weak SAP + Indian GST integration.

## 2. Product Vision

A configurable, multi-tenant SaaS that any SAP-running seller can subscribe to and, within weeks (not months), give their B2B customers a branded self-service portal covering the full order-to-cash cycle — with native SAP integration and built-in Indian GST compliance (GSTIN validation, e-invoice IRN, e-way bill).

## 3. Target Market & Personas

**Tenants (buyers of the SaaS):** Indian manufacturers, distributors, auto-component suppliers, industrial goods companies with 50–5,000 B2B customers, running SAP ECC 6.0 or S/4HANA. Economic buyer: CIO/CFO/Head of Sales.

**Personas:**

1. **End Customer (Dealer/Distributor purchaser)** — wants 24×7 ordering, own prices, order status, invoices, easy payment.
2. **Tenant Sales User** — quotations, order confirmations, onboarding approvals.
3. **Tenant Credit Controller** — credit limit approvals, blocked-order release.
4. **Tenant Support Agent** — SLA-driven ticket resolution.
5. **Tenant Admin** — branding, user/role management, SAP connection config, workflow config, module toggles.
6. **Platform Operator (us)** — tenant provisioning, billing, monitoring, support.

## 4. Goals & Success Metrics

| Goal               | Metric                         | Target (12 mo post-GA) |
| ------------------ | ------------------------------ | ---------------------- |
| Tenant acquisition | Paying tenants                 | 15–25                  |
| Fast onboarding    | Tenant go-live time            | < 4 weeks              |
| Order digitization | % tenant orders via portal     | > 60%                  |
| Collections        | Avg. DSO reduction for tenants | 10–20%                 |
| Reliability        | Uptime                         | 99.9%                  |
| SAP sync quality   | Failed sync rate               | < 0.5% with auto-retry |

## 5. Scope — Functional Requirements by Module

Requirement IDs: `FR-<module>-<n>`. Priority: P0 = MVP, P1 = Fast-follow, P2 = Later.

### 5.1 Customer Onboarding (P0)

- FR-ONB-1: Multi-step self-registration: Company Info → Tax & Regulatory → Credit & Commercial → Documents (per functional spec doc 03).
- FR-ONB-2: Real-time GSTIN validation via GSP/GSTN API; PAN format validation; duplicate-customer guard (GSTIN/PAN match against tenant's existing customers).
- FR-ONB-3: Document upload (PAN, GST certificate, incorporation) with type/size validation; stored per-tenant, linked to SAP via GOS on creation.
- FR-ONB-4: Configurable internal approval workflow (parallel Sales + Credit review); approve / reject-with-reasons / request-more-info.
- FR-ONB-5: On approval, create SAP customer master (general + sales area + credit data) via adapter; sync back customer code; issue portal credentials.
- FR-ONB-6: Tenant-configurable mandatory fields and document list per customer account group.

### 5.2 Product Catalogue (P0)

- FR-CAT-1: Search/browse by material, description, material group; filter by plant.
- FR-CAT-2: Customer-specific pricing from SAP condition records (list price, discounts, MOQ); never show another customer's price.
- FR-CAT-3: Live/near-live stock availability per plant (configurable: real-time ATP vs. cached).
- FR-CAT-4: Product images/spec sheets managed in portal (tenant admin upload) keyed to material.
- FR-CAT-5: Cart → proceeds to Inquiry or direct Sales Order (tenant-configurable path).

### 5.3 Inquiry & Quotation (P1)

- FR-INQ-1: Raise inquiry with line items, required date, validity, free-text requirements.
- FR-INQ-2: Sales-side quotation workbench; issue quotation with prices, validity, GST.
- FR-INQ-3: Customer accept / request-revision loop; acceptance auto-creates sales order with document reference.

### 5.4 Sales Order Management (P0)

- FR-ORD-1: Create order directly, from cart, or from accepted quotation; header (PO ref, requested date, ship-to) + line items.
- FR-ORD-2: ATP check on submit; show confirmed qty/date per schedule line.
- FR-ORD-3: SAP credit check result surfaced (Released/Blocked); blocked orders enter credit-release queue.
- FR-ORD-4: Order status tracking (Open/In Process/Partially Delivered/Completed) and PDF order confirmation download.
- FR-ORD-5: Change/cancel request workflow (subject to status rules).

### 5.5 Delivery & Tracking (P0)

- FR-DEL-1: Delivery status timeline (Not Started → Picked → Packed → Shipped → Delivered) from SAP delivery/goods-movement status.
- FR-DEL-2: Carrier, AWB/tracking number, planned vs. actual dispatch dates; e-way bill number + download.
- FR-DEL-3: Proof of Delivery: confirm receipt, received qty, upload signed POD; discrepancy report auto-creates support ticket.

### 5.6 Billing & Invoices (P0)

- FR-INV-1: Invoice list/detail with taxable value, CGST/SGST/IGST breakup, total, due date; PDF download.
- FR-INV-2: e-Invoice display: IRN + QR code; download e-invoice copy.
- FR-INV-3: Credit/debit notes with reason codes and original-invoice linkage.
- FR-INV-4: Raise dispute against invoice → routed workflow (may result in credit note).

### 5.7 Payments & Statement (P0)

- FR-PAY-1: Account statement (date range, doc type filters, running balance, open/cleared status); export PDF/Excel.
- FR-PAY-2: Pay one or more open invoices (full/partial) via integrated gateway (UPI/NEFT/netbanking/card); tenant brings own gateway account (Razorpay/PayU/Cashfree — at least one at MVP).
- FR-PAY-3: On success, auto-post incoming payment in SAP with gateway ref and clear open items; reconciliation report for exceptions.

### 5.8 Service & Support (P1)

- FR-SUP-1: Ticket creation (category, priority, order/invoice reference, attachments); auto-routing by category; SLA timers and escalation.
- FR-SUP-2: Ticket tracking, resolution notes, reopen, CSAT rating.
- FR-SUP-3: Optional SAP QM notification creation (tenant-configurable; default: portal-native ticketing).

### 5.9 Loyalty & Credit (P2)

- FR-LOY-1: Credit dashboard: limit, utilized, available, block status, DSO.
- FR-LOY-2: Credit-limit increase request workflow.
- FR-LOY-3: Configurable loyalty tiers from YTD billed value; rebate agreement visibility and accrual statement.

### 5.10 Reports & Analytics (P1)

- FR-RPT-1: Customer dashboard: YTD purchases, open orders, pending invoices, OTD %, order trend, top products, AR aging.
- FR-RPT-2: Tenant-side analytics: portal adoption, order volume/value, collection performance, ticket SLAs.
- FR-RPT-3: Export (PDF/Excel) and scheduled email reports (P2).

### 5.11 SaaS Platform Requirements (P0 — new vs. reference)

- FR-PLT-1: Tenant onboarding wizard: org profile, branding (logo/colors/custom domain), SAP connection setup + test, GSP credentials, payment gateway keys, module toggles.
- FR-PLT-2: RBAC with tenant-defined roles across customer/sales/credit/support/admin personas; SSO (SAML/OIDC) for tenant internal users (P1).
- FR-PLT-3: Full tenant data isolation; per-tenant encryption of SAP/GSP/gateway credentials.
- FR-PLT-4: Notification engine: email + in-app (P0), SMS/WhatsApp (P1), per-event templates, tenant-customizable.
- FR-PLT-5: Platform operator console: tenant CRUD, plan/billing management, usage metering, health monitoring, feature flags.
- FR-PLT-6: Subscription billing for tenants (plan tiers, seat/volume metering, invoicing).
- FR-PLT-7: Audit log of all business-critical actions (who/what/when, per tenant).

## 6. Non-Functional Requirements

- **NFR-1 Availability:** 99.9% monthly; SAP outage degrades gracefully (cached reads, queued writes).
- **NFR-2 Performance:** P95 page < 2s; catalogue search < 1s (cached); order submit < 5s incl. SAP round-trip.
- **NFR-3 Scale:** 100 tenants, 500K end-customer users, 50K orders/day design target.
- **NFR-4 Security:** OWASP ASVS L2, encryption at rest/in transit, per-tenant key isolation, SOC 2 Type II roadmap; DPDP Act (India) compliance; data residency in India.
- **NFR-5 Auditability:** immutable audit trail, 7-year retention for financial documents (Indian statutory).
- **NFR-6 Localization:** ₹ + Indian number formatting, IST, GST fiscal-year (Apr–Mar); English UI at MVP, Hindi/regional P2.
- **NFR-7 Accessibility:** WCAG 2.1 AA.
- **NFR-8 Mobile:** responsive web at MVP; native apps out of scope.

## 7. Out of Scope (v1)

Marketplace/multi-seller commerce, B2C, non-SAP ERPs (design adapter to allow later), procurement-side (supplier portal), CPQ configurators, offline mode, native mobile apps, non-India tax regimes.

## 8. Assumptions & Dependencies

- Tenants provide SAP access (RFC user or OData service user) and network path (VPN/cloud connector).
- Tenants own GSP subscriptions and payment gateway merchant accounts (we integrate; we don't resell).
- GSTN/e-invoice/e-way APIs accessed via a GSP aggregator.
- Design-partner tenants available for pilot (2 minimum).

## 9. Risks

| Risk                                                 | Impact   | Mitigation                                                            |
| ---------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| SAP landscape variability (Z-fields, custom pricing) | High     | Adapter layer + per-tenant field mapping config; mock adapter for dev |
| SAP connectivity/perf from cloud                     | High     | Caching + async queue + circuit breakers; on-prem connector agent     |
| Long enterprise sales cycles                         | Med      | Design partners, fast time-to-value, module-priced tiers              |
| GST regulation changes                               | Med      | GSP abstraction; compliance watch                                     |
| Tenant data breach                                   | Critical | Isolation testing, pen tests, least-privilege SAP users               |

## 10. Release Plan (summary — detail in doc 05)

- **MVP (P0):** Platform core + Onboarding, Catalogue, Orders, Delivery tracking, Invoices, Payments — one SAP flavor end-to-end, 2 pilot tenants.
- **R2 (P1):** Inquiry/Quotation, Support, Reports, SSO, WhatsApp notifications, second SAP flavor.
- **R3 (P2):** Loyalty/rebates, scheduled reports, localization, marketplace of extensions.
