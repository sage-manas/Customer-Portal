# 00 — Portal Overview: What This Product Is and How It Works

> Companion reading for the PRD/TRD set. Read this first.

## 1. What the portal is

The reference design describes a **B2B Customer Self-Service Portal** that sits in front of a manufacturer's / distributor's **SAP ERP (SD + FI-AR modules)** and exposes the entire **Order-to-Cash (O2C) cycle** to the manufacturer's business customers (dealers, distributors, retailers, OEM buyers) over the web.

Today, in most Indian mid-market enterprises, this cycle runs on phone calls, WhatsApp, emails and a sales coordinator manually keying data into SAP transactions (VA01, VF01, F-28...). The portal digitizes and self-services that entire loop:

**Customer registers → gets approved → browses catalogue with their own prices → raises inquiry → receives quotation → converts to order → order passes credit check → warehouse ships → customer tracks delivery + e-way bill → invoice with IRN generated → customer pays online → payment auto-posted and cleared in SAP → statements, tickets, loyalty and dashboards on top.**

The portal never becomes the system of record. **SAP remains the single source of truth**; the portal is a real-time read/write façade over it.

## 2. Why it exists (business purpose)

- **For the seller (your tenant):** fewer manual order-entry errors, lower cost-to-serve, faster order cycle, faster collections (online payment against open items), automated GST compliance (GSTIN validation, e-invoice IRN, e-way bill), better credit discipline (real-time exposure vs. limit), and customer stickiness via loyalty/rebates.
- **For the buyer (tenant's customer):** 24×7 ordering, transparent pricing per their negotiated contracts, live stock, order/delivery status, downloadable invoices and statements, one place to dispute and pay.

## 3. The ten modules and how they chain together

| #   | Module                   | What it does                                                                                                                                           | Core SAP touchpoints                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | **Customer Onboarding**  | 4-step registration (Company → Tax → Credit → Documents), GSTIN/PAN validation, internal Sales + Credit approval, then customer master creation in SAP | `BAPI_CUSTOMER_CREATEFROMDATA1`, KNA1/KNVV/KNKK/KNBK, FD32 |
| 2   | **Product Catalogue**    | Browse/search materials with **customer-specific pricing** (condition records) and live plant stock (ATP)                                              | MARA/MAKT/MARC/MARD, KONP (PR00/K007), VK13                |
| 3   | **Inquiry & Quotation**  | Customer raises inquiry (VA11 equivalent); sales issues quotation (VA21); customer accepts → auto-converted to order with reference                    | VBAK/VBAP, BAPI_QUOTATION_CREATE                           |
| 4   | **Sales Order**          | Direct or quote-referenced order, ATP check, **automatic credit check** (release/block), order confirmation PDF                                        | VA01 / BAPI_SALESORDER_CREATEFROMDAT2, VBEP, VBUK-CMGST    |
| 5   | **Delivery & Tracking**  | Pick/pack/PGI status, carrier + AWB, **e-way bill**, proof-of-delivery with discrepancy reporting                                                      | LIKP/LIPS, VL03N, VLPOD, J_1I e-way bill                   |
| 6   | **Billing & Invoices**   | Invoice view/download, GST breakup (CGST/SGST/IGST), **e-invoice IRN + QR**, credit/debit notes                                                        | VBRK/VBRP, VF01, J_1I IRN, G2/L2 billing types             |
| 7   | **Payments & Statement** | Ledger statement (open/cleared items), online payment via gateway (UPI/NEFT/card), auto-posting + clearing                                             | BSID/BSAD/BSEG, FBL5N, F-28, gateway webhook               |
| 8   | **Service & Support**    | Category-routed tickets with SLA, linked to orders/invoices                                                                                            | QMEL (QM01 notifications) or CRM ticketing                 |
| 9   | **Loyalty & Credit**     | Credit position (limit/utilized/available, DSO), loyalty tiers from YTD billing, rebate agreements                                                     | KNKK, KONA (VBO1/VBO2)                                     |
| 10  | **Reports & Analytics**  | Self-service dashboards: purchase trends, open orders, AR aging, OTD %                                                                                 | Aggregates over VBAK/VBRK/BSID/LIKP                        |

### The O2C chain in one line

Onboard → Catalogue → Inquiry/Quote → Order (credit check gate) → Delivery (PGI gate) → Invoice (IRN) → Payment (clearing) — with Support, Loyalty and Reports as cross-cutting services.

## 4. Actors

- **Customer user** (external) — the buyer's staff; browse, order, track, pay, raise tickets.
- **Sales** (internal) — quotations, order confirmation, onboarding review.
- **Credit team** (internal) — credit limit approval, released blocked orders.
- **Warehouse** (internal, mostly via SAP) — pick/pack/ship; portal reads status.
- **Support** (internal) — ticket resolution within SLA.
- **System** — validation, SAP sync, GSTN APIs, payment gateway, notifications.

## 5. Key decision gates in the flow

1. **Onboarding approval** — reject → email with reasons; approve → SAP customer master + portal access.
2. **Quotation acceptance** — revise loop vs. convert-to-order.
3. **Credit check on order** — released → delivery planning; blocked → credit team review (FD32 release).
4. **Delivery POD** — confirmed receipt vs. discrepancy → auto service ticket.
5. **Invoice acceptance** — pay vs. dispute → credit/debit note process.

## 6. India-compliance layer (built into the core)

- **GSTIN validation** via GSTN public API at onboarding (real-time).
- **Place of Supply** driven by customer's state (REGIO) → CGST+SGST vs. IGST determination.
- **e-Invoice (IRN)**: 64-char hash + QR from the Invoice Registration Portal, mandatory above turnover threshold.
- **e-Way Bill**: mandatory for consignments > ₹50,000; generated at PGI.
- PAN/TAN/CIN/Udyam capture for TCS/MSME obligations.

## 7. What changes when it becomes SaaS

The reference is a single-company portal. As SaaS you sell it to **many seller organizations (tenants)**, each with:

- Their **own SAP system** (ECC or S/4HANA, on-prem or cloud) → per-tenant connector configuration through an **integration adapter layer** (BAPI/RFC for ECC, OData for S/4).
- Their own branding, domains, catalogue, pricing, users, approval workflows, payment gateway account, GSP (GST Suvidha Provider) credentials.
- Strict **tenant data isolation** — one tenant's customers must never see another's data.
- A **tenant admin console** (you also need a **platform operator console** for yourselves: tenant provisioning, billing, monitoring).

So the SaaS actually has **three planes**: Platform (you), Tenant (the seller company + its internal users), and End-customer (the buyer). This is the central architectural addition over the reference design — covered in the TRD.

## 8. How you'll proceed (short version — full plan in doc 05)

1. Validate scope → freeze MVP (Onboarding, Catalogue, Order, Invoice, Payment for one SAP flavor).
2. Design multi-tenant foundation (auth, tenancy, RBAC, SAP adapter abstraction) before any module.
3. Build a **mock SAP adapter** first so product development never blocks on SAP access.
4. Pilot with 1–2 design-partner tenants against their real SAP.
5. Harden: security audit, GST compliance certification path, observability, SLAs → GA.
