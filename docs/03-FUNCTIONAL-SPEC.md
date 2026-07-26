# 03 — Functional Specification: Screens, Fields & SAP Mapping

Version 1.0 · Extracted and normalized from the reference design. UI is indicative only — final UX to be designed fresh; **field inventory and SAP mappings below are the contract**.

Legend — Req: M = mandatory, O = optional, C = conditional, R = read-only/display. Types are SAP dictionary types (CHAR/NUMC/DATS/CURR/QUAN/UNIT/TEXT/FILE/STATUS/SELECT/BOOLEAN). All SAP field names are the ECC defaults; per-tenant overrides via the mapping engine (TRD §4.2).

---

## Module 1 — Customer Onboarding (4-step wizard, then internal approval)

### Screen 1.1 Company Information (Customer, step 1/4)

| Field             | SAP            | Type/Len | Req | Notes                                                                        |
| ----------------- | -------------- | -------- | --- | ---------------------------------------------------------------------------- |
| Legal Entity Name | KNA1-NAME1     | CHAR 35  | M   | As per registration cert                                                     |
| Trade/Brand Name  | KNA1-NAME2     | CHAR 35  | O   |                                                                              |
| Customer Type     | KNA1-KTOKD     | CHAR 4   | M   | Account group: Retailer/Distributor/Direct/Export — controls field selection |
| Street/Area       | KNA1-STRAS     | CHAR 35  | M   |                                                                              |
| City              | KNA1-ORT01     | CHAR 35  | M   |                                                                              |
| State             | KNA1-REGIO     | CHAR 3   | M   | T005S; drives GST Place of Supply                                            |
| PIN Code          | KNA1-PSTLZ     | CHAR 10  | M   | 6-digit validation                                                           |
| Country           | KNA1-LAND1     | CHAR 3   | M   | Default IN                                                                   |
| Contact Person    | KNA1-ANSPK     | CHAR 30  | M   |                                                                              |
| Email             | ADR6-SMTP_ADDR | CHAR 241 | M   | Portal login ID; comm type INT                                               |
| Phone             | KNA1-TELF1     | CHAR 16  | M   | 10–15 digits                                                                 |

Actions: Save Draft · Save & Continue. SAP write happens only at final approval via BAPI_CUSTOMER_CREATEFROMDATA1 (ECC) / BP API (S/4).

### Screen 1.2 Tax & Regulatory (step 2/4)

| Field                 | SAP                        | Type/Len | Req | Notes                                                                          |
| --------------------- | -------------------------- | -------- | --- | ------------------------------------------------------------------------------ |
| PAN                   | KNA1-STCD3                 | CHAR 10  | M   | Format AAAAA9999A                                                              |
| GSTIN                 | KNA1-STCD2                 | CHAR 15  | M   | Real-time GSTN API verification; must contain PAN; state code must match REGIO |
| GST Registration Type | J_1IMOCUST-J_1IGSTIN_REGTP | CHAR 2   | M   | 01 Regular / 02 Composition / 03 Unregistered / 04 SEZ                         |
| CIN                   | KNA1-STCD1                 | CHAR 21  | O   | Pvt/Public Ltd                                                                 |
| TAN                   | KNA1-STCD4                 | CHAR 10  | O   | TCS applicability                                                              |
| MSME/Udyam No.        | KNA1-STCD5                 | CHAR 20  | O   | Buyer MSME obligations                                                         |

### Screen 1.3 Credit & Commercial Terms (step 3/4)

| Field                    | SAP        | Type/Len | Req | Notes                      |
| ------------------------ | ---------- | -------- | --- | -------------------------- |
| Requested Credit Limit ₹ | KNKK-KLIMK | CURR 15  | M   | Subject to approval (FD32) |
| Payment Terms Requested  | KNVV-ZTERM | CHAR 4   | O   | T052                       |
| Preferred Sales Office   | KNVV-VKBUR | CHAR 4   | O   |                            |
| Account Holder Name      | BNKA-KOINH | CHAR 60  | O   | Refunds                    |
| Bank Account No.         | KNBK-BANKN | CHAR 18  | O   |                            |
| IFSC                     | KNBK-BANKL | CHAR 11  | O   |                            |

### Screen 1.4 Documents & Approval (step 4/4; approval part internal)

Customer uploads: PAN card copy (M), GST certificate (M, must match GSTIN), Incorporation cert (O). Stored in portal object storage; attached to SAP customer via GOS post-creation.

Internal approval fields: Sales Org KNVV-VKORG (CHAR 4, M), Distribution Channel KNVV-VTWEG (CHAR 2, M — determines pricing procedure), Credit Approval Status KNKK-CTLPC (SELECT, O). Actions: Request More Info / Reject (with reasons) / Approve & Create in SAP.

**Process flow:** Register → System validation (PAN/GSTIN, dupe guard, doc formats) → parallel Sales + Credit review → gate: Approved → BAPI create + customer code sync-back + credentials issued; Rejected → email with reasons.

---

## Module 2 — Product Catalogue

### Screen 2.1 Browse Catalogue (Customer)

Filters: search (MARA-MATNR / MAKT-MAKTX), Material Group (MARA-MATKL, T023), Plant (MARC-WERKS).

Product card: Material Code (MARA-MATNR CHAR 18), Description (MAKT-MAKTX CHAR 40), List Price (KONP-KBETR CURR 11 — condition PR00, customer-specific via VK11/VK13), Available Stock (MARD-LABST QUAN 13 — ATP; consider MARC-WEBAZ lead time), UoM (MARA-MEINS UNIT 3), Image/spec sheet (portal-managed, GOS-linked). Actions: Add to Cart · Request Quote.

### Screen 2.2 Customer-Specific Price List

Condition record ref (KONH-KNUMH CHAR 10), Valid From/To (KONH-DATAB/DATBI DATS), Discount % (KONP-KBETR — K007/K005), MOQ (MVKE-MINBM QUAN 13). Actions: Download Price List · Contact Sales.

**Flow:** Browse → system applies customer pricing (VK13 conditions) → Add to cart / Request quote → Inquiry or Order.

---

## Module 3 — Inquiry & Quotation

### Screen 3.1 Raise Inquiry (Customer)

Header: Inquiry Type (VBAK-AUART, "IN"), Required Delivery Date (VBAK-VDATU DATS, M), Validity Days (VBAK-ANGDT NUMC, O). Lines: Material (VBAP-MATNR, M), Quantity (VBAP-KWMENG QUAN, M — triggers ATP), UoM (VBAP-VRKME UNIT, M). Notes: header sales text (STXH-TDLINE TEXT 2000). Result: VBAK-VBELN auto-generated (VA11 / BAPI_QUOTATION_CREATE path).

### Screen 3.2 View Quotation (Customer)

Quotation No. (VBAK-VBELN R), Date (ERDAT), Valid Until (VBAK-BNDDT), Unit Price (VBAP-NETPR CURR — ex-GST), Tax code (VBAP-MWSK1), Total (VBAK-NETWR incl. GST). Actions: Request Revision · Accept & Convert to Order (VA01 with reference — copy control).

**Flow:** Raise inquiry → Sales prepares quotation (VA21, customer pricing) → Customer reviews → gate: Accept → auto-convert to order; Revise → re-quote loop.

---

## Module 4 — Sales Order Management

### Screen 4.1 Create Order (Customer)

Header: Customer PO Ref (VBKD-BSTNK CHAR 20, O — printed on confirmation; also used as portal idempotency key), Requested Delivery Date (VBAK-VDATU, M), Ship-to (VBPA-KUNNR partner SH, M — from saved addresses). Lines: Material (VBAP-MATNR, M), Qty (VBAP-KWMENG, M), UoM (VBAP-VRKME, M), Price (VBAP-NETPR, pre-filled from quote), Plant (VBAP-WERKS, auto). Terms: Payment Terms (VBKD-ZTERM, defaults KNVV-ZTERM), Incoterms (VBKD-INCO1), Delivery Priority (VBAK-LPRIO). Actions: Save Draft · Check Availability (ATP simulate) · Submit (VA01 / BAPI_SALESORDER_CREATEFROMDAT2).

### Screen 4.2 Order Status & Confirmation

SO Number (VBAK-VBELN R), Order Status (VBUK-GBSTK: A Open / B Partial / C Complete), Confirmed Qty (VBEP-BMENG per schedule line), Confirmed Date (VBEP-EDATU), Credit Status (VBUK-CMGST: A not checked / B blocked / C released), Order Confirmation PDF (output BA00 via NAST). Actions: Request Change · Cancel · Track Delivery.

**Flow:** Create (ATP) → Credit check gate: Released → delivery planning; Blocked → credit team release (FD32) → Confirmation (BA00 PDF/email) → Delivery creation (VL01N, pick/pack/PGI).

---

## Module 5 — Delivery & Tracking

### Screen 5.1 Track Delivery

Delivery No. (LIKP-VBELN), Linked SO (LIKP-VGBEL), Status (VBUK-WBSTK: Not Started/Picked/Packed/Shipped/Delivered), Planned GI (LIKP-WADAT), Actual Dispatch (LIKP-WADAT_IST), Carrier (LIKP-TDLNR), AWB/Tracking (LIKP-TRAID — carrier link), E-Way Bill No. (J_1IEXCHDR-J_1IEWB_NO CHAR 12 — mandatory > ₹50,000). Actions: Download E-Way Bill · Raise Delivery Issue.

### Screen 5.2 Proof of Delivery

Receipt confirmation (LIKP-KOQUK BOOLEAN — VLPOD), Received Qty (LIPS-LFIMG — compared vs. dispatched for discrepancy flag), Receipt Date, Discrepancy notes (portal field → auto service ticket), Signed POD upload (GOS). Actions: Report Discrepancy · Confirm Receipt.

**Flow:** Pick & pack → PGI (stock reduced, e-way bill) → Customer tracks → gate: Delivered → POD confirm (triggers billing); Issue → ticket.

---

## Module 6 — Billing & Invoices

### Screen 6.1 View Invoices

Invoice No. (VBRK-VBELN — VF03), Date (VBRK-FKDAT), Ref SO/Delivery (VBRP-VGBEL), Taxable Amount (VBRP-NETWR ex-GST), CGST/SGST/IGST (KONV-KBETR — JOCG/JOSG/JOIG conditions), Total (gross incl. GST), IRN (J_1IEXCHDR-J_1I_IRN CHAR 64 — mandatory if turnover > threshold), Due Date (BSID-ZFBDT + terms). Actions: Download PDF · Download e-Invoice · Raise Dispute.

### Screen 6.2 Credit / Debit Notes

Doc No. (VBRK-VBELN), Type (VBRK-FKART: G2 credit / L2 debit), Reason Code (VBRP-MGAGR), Amount (NETWR), Original Invoice (VGBEL). Action: Download.

**Flow:** Billing created (VF01 from delivery/order, pricing + GST auto) → e-invoice IRN + QR via GSTN → Customer reviews → gate: Accept → payment; Dispute → credit/debit note process.

---

## Module 7 — Payments & Statement

### Screen 7.1 Account Statement

Date range (BKPF-BUDAT), Doc Type (BKPF-BLART: RV invoice / DZ payment / G2 credit note), Debits (BSEG-WRBTR, posting key 01), Credits (BSEG-WRBTR, key 15), Outstanding (BSID-DMBTR — BSID open / BSAD cleared), Clearing doc (BSEG-AUGBL). Source: FBL5N / BAPI_AR_ACC_GETOPENITEMS. Actions: Export Excel · PDF Statement.

### Screen 7.2 Make Payment

Multi-select open invoices (BSID-BELNR), Amount (full/partial), Mode (UPI/NEFT/Card/Netbanking — gateway), Gateway ref auto-filled to BSEG-KIDNO. On webhook success: post incoming payment (F-28 equivalent) + clear items.

**Flow:** Initiate → gateway → webhook → SAP posting/clearing → statement updates; gate: fully cleared vs. partial residual tracked.

---

## Module 8 — Service & Support

### Screen 8.1 Raise Ticket

Category (QMEL-QMART — Delivery/Quality/Billing/Product/General; drives routing), Related doc (QMEL sales-doc ref, O), Priority (QMEL-PRIOK), Subject (QMEL-QMTXT CHAR 40), Description (long text 2000), Attachment (GOS). Creates QM notification (QM01) or portal-native ticket per tenant config.

### Screen 8.2 Track Tickets

Ticket No. (QMEL-QMNUM), Status (system status Open/In Progress/Resolved/Closed), Assigned To (QMEL-VERAN), Resolution notes + date (QMEL-IDATE). Actions: Reopen · Rate (CSAT).

**Flow:** Raise → auto-route by category, SLA timer → resolve gate: Resolved → notify; SLA breach → escalate.

---

## Module 9 — Loyalty & Credit

### Screen 9.1 Credit Position

Approved Limit (KNKK-KLIMK), Utilized (KNKK-SKFOR — open orders + open AR), Available (computed KLIMK − SKFOR), Block status (KNKK-CTLPC), DSO (computed, 90-day). Action: Request Credit Limit Increase (workflow).

### Screen 9.2 Loyalty & Rebates

Tier (computed from YTD VBRK-NETWR: Bronze/Silver/Gold/Platinum, tenant-configurable thresholds), YTD Purchase Value, Rebate Agreement (KONA-KNUMA — VBO1), Accrued Rebate (KONA-KAWRT, settled via VBO2), Next-tier threshold (computed). Actions: Rebate Statement · Redeem.

---

## Module 10 — Reports & Analytics

### Screen 10.1 Sales Dashboard (Customer)

YTD purchases (Σ VBRK-NETWR), Open orders (VBAK, VA05 equivalent), Pending invoices (BSID-DMBTR), On-time delivery % (LIKP WADAT vs WADAT_IST), Orders by month (VBAK-ERDAT), Top products (VBAP-MATNR grouped), Avg order value. Actions: Export PDF · Schedule Report.

### Screen 10.2 AR Aging

Buckets 0–30 / 31–60 / 61–90 / >90 days over BSID-DMBTR (FBL5N / S_ALR_87012173 equivalents). Action: Download AR Statement.

Data source: nightly aggregation + real-time reads, always filtered to the logged-in customer's KUNNR set.

---

## Cross-cutting SAP integration summary

| Module        | Primary API (ECC)                          | S/4 alternative               | Protocol    | Trigger             |
| ------------- | ------------------------------------------ | ----------------------------- | ----------- | ------------------- |
| Onboarding    | BAPI_CUSTOMER_CREATEFROMDATA1              | Business Partner API          | RFC         | On approval         |
| Catalogue     | material/stock reads + VK13 conditions     | API_PRODUCT_SRV, ATP API      | RFC / OData | Cached reads        |
| Inquiry/Quote | BAPI_QUOTATION_CREATEFROMDATA2             | API_SALES_QUOTATION_SRV       | RFC / OData | On submit           |
| Order         | BAPI_SALESORDER_CREATEFROMDAT2 (+SIMULATE) | API_SALES_ORDER_SRV           | RFC / OData | On submit + ATP     |
| Delivery      | delivery reads, VLPOD                      | API_OUTBOUND_DELIVERY_SRV     | RFC / OData | On PGI / poll       |
| Billing       | billing doc reads, PDF via output          | API_BILLING_DOCUMENT_SRV      | RFC / OData | On billing creation |
| Payment       | incoming payment posting + clearing        | Journal Entry / Clearing APIs | RFC / OData | Gateway webhook     |
| Ledger        | BAPI_AR_ACC_GETOPENITEMS                   | AR line-item APIs             | RFC / OData | On demand           |
