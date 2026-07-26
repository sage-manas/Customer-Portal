# 05 — UI/UX Design Specification

## CustomerConnect Portal — Multi-Tenant SAP-Integrated B2B Customer Portal

Version 1.0 · 2026-07-25 · Companion to 00-Overview, 01-PRD, 02-TRD, 03-Functional-Spec, 04-Roadmap
Source of truth for screens & field mapping: the React reference file (`Screens & Mapping` + `Process Flow` views).

---

## Table of Contents

1. Design Principles
2. Design System (tokens, typography, color, spacing)
3. Component Library
4. Information Architecture & Navigation
5. Layout System & Responsive Strategy
6. Global UX Patterns (states, feedback, SAP-sync semantics)
7. Module-by-Module Screen Specifications (10 modules)
8. Cross-Cutting Screens (auth, tenant admin, errors)
9. Accessibility (WCAG 2.1 AA)
10. Interaction & Motion
11. Content & Microcopy Guidelines
12. Design-to-Dev Handoff Conventions

---

## 1. Design Principles

| #   | Principle                                       | What it means in practice                                                                                                                                                                        |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | **SAP is the truth; the UI is honest about it** | Every SAP-sourced value shows its freshness (synced timestamp) and read-only fields are visually distinct. Never fake real-time when data is batched.                                            |
| P2  | **B2B users are repeat power users**            | Optimize for speed on the 2nd–200th visit: dense tables, keyboard navigation, saved filters, bulk actions, recently-used defaults.                                                               |
| P3  | **Every field carries its contract**            | Portal fields map 1:1 to SAP fields (table-field, type, length). Validation rules derive from SAP data types (CHAR 35 = maxLength 35). The mapping is a first-class artifact, not documentation. |
| P4  | **Status is a spine, not a decoration**         | The O2C chain (Order → Delivery → Invoice → Payment) is one continuous status timeline the user can traverse from any document.                                                                  |
| P5  | **Compliance is visible, not buried**           | GSTIN, IRN, e-way bill are surfaced as trust signals (badges with verify actions), because Indian B2B buyers actively check them.                                                                |
| P6  | **Tenant-brandable, structurally fixed**        | Tenants can change logo, primary color, domain. They cannot restructure layouts — consistency keeps support and docs sane.                                                                       |
| P7  | **Graceful degradation on SAP outage**          | Reads fall back to last-synced cache with a stale banner; writes queue with explicit "pending sync to SAP" status. The portal never hard-fails because SAP is down.                              |

---

## 2. Design System

### 2.1 Design Tokens (single source: `packages/ui/tokens.ts`)

All colors, spacing, radii, shadows and type styles are defined as tokens and exported as CSS variables + Tailwind theme. **No raw hex values in component code.**

#### Color — semantic tokens (light theme; tenant primary is overridable)

| Token                    | Default                                         | Usage                                                     |
| ------------------------ | ----------------------------------------------- | --------------------------------------------------------- |
| `--color-primary`        | `#5b21b6` (violet-800)                          | Brand actions, active nav, links. **Tenant-overridable.** |
| `--color-primary-dark`   | `#4c1d95`                                       | Hover/pressed                                             |
| `--color-primary-subtle` | `#f5f3ff`                                       | Selected rows, active backgrounds                         |
| `--color-nav`            | `#1e1b3a`                                       | Top bar / dark chrome                                     |
| `--color-success`        | `#15803d` / subtle `#f0fdf4` / border `#bbf7d0` | Delivered, Paid, Released, Approved                       |
| `--color-warning`        | `#b45309` / `#fffbeb` / `#fde68a`               | Open invoice, pending approval, partial                   |
| `--color-danger`         | `#be123c` / `#fef2f2` / `#fecdd3`               | Overdue, credit hold, rejected, destructive               |
| `--color-info`           | `#1d4ed8` / `#eff6ff` / `#bfdbfe`               | In transit, informational                                 |
| `--color-teal`           | `#0e7490`                                       | Quantities/logistics accents                              |
| `--color-surface`        | `#ffffff`                                       | Cards                                                     |
| `--color-background`     | `#f5f6fb`                                       | Page background                                           |
| `--color-border`         | `#e2e8f0` / strong `#cbd5e1`                    | Dividers, inputs                                          |
| `--color-text`           | `#0f172a` / mid `#334155` / dim `#64748b`       | Text hierarchy                                            |

#### Module accent colors (fixed, from reference)

`onboard #5b21b6 · catalog #1d4ed8 · inquiry #0e7490 · order #15803d · delivery #0891b2 · invoice #b45309 · payment #be123c · support #be185d · loyalty #9333ea · report #ea580c`

Accents are used only for: module nav highlight, section markers, screen-header gradient tint, primary CTA within that module. Status colors always win over module accents.

#### Typography

| Style         | Font           | Size/Weight                        | Usage                                                     |
| ------------- | -------------- | ---------------------------------- | --------------------------------------------------------- |
| Display       | Inter          | 20/700                             | Page titles                                               |
| H2            | Inter          | 15–18/700                          | Card/screen titles                                        |
| Section label | Inter          | 11.5/700, uppercase, +0.8 tracking | Form section headers                                      |
| Body          | Inter          | 12.5–13/400                        | Default text                                              |
| Caption/hint  | Inter          | 10.5–11/400, dim                   | Field hints, metadata                                     |
| Data/code     | JetBrains Mono | 10–12/500–600                      | SAP field names, document numbers, amounts, GSTIN/IRN/PAN |

**Rule:** anything that is an identifier or money renders in mono — this is the visual signature of the product.

#### Spacing, radius, elevation

- 4px base grid; component padding steps: 8 / 12 / 16 / 20 / 24 / 28.
- Radius: inputs & chips 6–7px, cards 10–12px, page containers 12–14px, pills 99px.
- Elevation: `sm 0 1px 3–4px rgba(0,0,0,.06)` (cards) · `md 0 2px 8px rgba(0,0,0,.07)` (screen frames) · `lg 0 4px 20px rgba(30,27,58,.3)` (hero banners). No heavy shadows.

### 2.2 Iconography

Lucide icons, 16/20/24px, stroke 1.75. Module emoji from the reference are placeholders — production uses Lucide equivalents (e.g. onboarding=`FileCheck`, catalogue=`ShoppingCart`, order=`Package`, delivery=`Truck`, invoice=`Receipt`, payment=`CreditCard`, support=`Headphones`, loyalty=`Award`, reports=`TrendingUp`).

---

## 3. Component Library

Built on shadcn/ui primitives; domain components live in `packages/ui`. Every component gets a Storybook story with all states.

### 3.1 Primitives (from shadcn/ui, themed by tokens)

Button (primary / secondary / ghost / destructive / link), Input, Select, Combobox, DatePicker, Textarea, Checkbox, RadioGroup, Switch, Tabs, Dialog, Sheet (drawer), Popover, Tooltip, Toast, Skeleton, Badge, Breadcrumb, Pagination, Table, Command palette.

### 3.2 Domain components (the ones that make this product)

| Component              | Spec                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SapField`**         | Wraps any input. Props: `label, sapTable, sapField, sapType (CHAR/NUMC/DATS/CURR/QUAN/...), length, required, hint`. Renders: label row (+ red `REQ` chip if required), input with validation derived from SAP type/length, footer strip with type chip (color-coded per type), `LEN n` chip, and `TABLE-FIELD` in mono right-aligned. Footer strip visible in "spec mode" (toggleable by tenant admin/dev), hidden for end customers by default. |
| **`StatusBadge`**      | Maps canonical statuses to color + label. One registry: `statusRegistry.ts` — `Confirmed/Released → success`, `In Transit/In Process → info`, `Open/Partial/Pending → warning`, `Overdue/Blocked/Credit Hold/Rejected → danger`, `Delivered/Cleared/Paid → success`, `Draft → neutral`. UI never hardcodes status colors.                                                                                                                         |
| **`DocumentNumber`**   | Mono, primary-colored, clickable; renders SAP doc numbers (SO/DEL/INV) with copy-on-hover and deep link to the document detail.                                                                                                                                                                                                                                                                                                                   |
| **`Money`**            | Formats INR with lakh/crore grouping (`₹ 4,80,000`), mono, right-aligned in tables, sign & color rules for credit/debit contexts. Locale-ready for future currencies.                                                                                                                                                                                                                                                                             |
| **`SapSyncIndicator`** | Dot + tooltip: `Live` (green, real-time read), `Synced 5m ago` (neutral), `Stale — SAP unreachable` (amber banner variant), `Pending sync` (spinner, queued write).                                                                                                                                                                                                                                                                               |
| **`O2CTimeline`**      | Horizontal stepper: Order → Credit Check → Delivery → Invoice → Payment, with per-step status, dates, and doc-number links. Rendered on every document detail page.                                                                                                                                                                                                                                                                               |
| **`DecisionGate`**     | Pass/fail pair (green ✓ / red ✗ chips) used in process-flow displays and approval screens (matches reference gate pattern).                                                                                                                                                                                                                                                                                                                       |
| **`KpiCard`**          | Icon tile + label + big value + sub-line + trend line, corner accent wash. Used on dashboards.                                                                                                                                                                                                                                                                                                                                                    |
| **`DataTable`**        | TanStack Table wrapper: server pagination, column sort, saved filters, sticky header, row-density toggle, CSV/XLSX export, empty/loading/error states built in, zebra rows.                                                                                                                                                                                                                                                                       |
| **`FileUpload`**       | Drag-drop, type/size validation (PDF/JPG ≤5MB default), progress, virus-scan pending state, links to GOS attachment on the SAP object.                                                                                                                                                                                                                                                                                                            |
| **`ComplianceBadge`**  | GSTIN (with GSTN-verified tick), IRN (64-char, truncated with copy + QR view), E-Way Bill number.                                                                                                                                                                                                                                                                                                                                                 |
| **`WizardShell`**      | Multi-step frame: step indicator (`1/4`), per-step validation, Save Draft (autosave every 30s), Back/Continue, exit-guard dialog. Used by Onboarding and any future wizard.                                                                                                                                                                                                                                                                       |
| **`AmountAging`**      | 4-bucket aging bar (0–30 / 31–60 / 61–90 / >90) with amounts, used in AR views.                                                                                                                                                                                                                                                                                                                                                                   |
| **`RolePill`**         | Customer / Sales / Credit / Warehouse / Support actor chips (colors per reference actor palette).                                                                                                                                                                                                                                                                                                                                                 |

### 3.3 Component states — mandatory matrix

Every interactive component ships with: default · hover · focus-visible · active · disabled · loading · error · empty · read-only. Tables/pages additionally: skeleton loading, empty (with CTA), error (with retry), stale-data banner.

---

## 4. Information Architecture & Navigation

### 4.1 Site map (customer-facing portal)

```
/                        Customer Dashboard (home)
/catalogue               Browse · /catalogue/[matnr] Product detail · /catalogue/price-list
/inquiries               List · /inquiries/new (Raise) · /inquiries/[id]
/quotations              List · /quotations/[id] (Review / Accept / Request revision)
/orders                  List · /orders/new (Create) · /orders/[vbeln] (Status & confirmation)
/deliveries              List · /deliveries/[vbeln] (Track) · /deliveries/[vbeln]/pod
/invoices                List · /invoices/[vbeln] · /invoices/notes (credit/debit notes)
/payments                Statement · /payments/pay (Make payment) · /payments/[id]/receipt
/support                 Tickets list · /support/new · /support/[qmnum]
/account                 Credit position · Loyalty & rebates · Company profile · Users · Addresses
/reports                 Sales dashboard · AR summary
```

Onboarding (pre-access): `/register` (4-step wizard) → `/register/status` (pending/approved/rejected).
Internal back-office (tenant plane): `/admin/*` — onboarding queue, quotation workbench, credit release queue, ticket workbench, tenant settings. Same design system, denser layout.

### 4.2 Navigation model

- **Top bar (52px, `--color-nav`):** tenant logo + product name, global search (⌘K command palette over docs/materials), notifications bell, user menu with account switcher (one user ↔ multiple sold-to accounts).
- **Left sidebar (222px, collapsible to 52px icon rail):** Dashboard, then 10 modules in O2C order (as reference). Active item: module-accent tinted background + border. Collapsed state shows icon + tooltip. State persisted per user.
- **Breadcrumbs** on all detail pages: `Orders / SO-2025-1841`.
- **Cross-document jumps:** every reference field (Linked Sales Order, Preceding Document, Original Invoice) is a `DocumentNumber` link. This is the primary navigation pattern after the sidebar.

### 4.3 Role-based visibility

Nav items and actions are permission-driven (RBAC claims), not hidden client-side only — the API enforces. Buyer view-only role sees no Create/Pay/Submit CTAs.

---

## 5. Layout System & Responsive Strategy

- **App shell:** top bar + sidebar + scrollable content (`24–28px` padding). Max content width 1440px centered on ultrawide.
- **Grid:** form sections use CSS grid, 3 columns default (as reference), 4 for KPI rows, 1 for long-text fields. Cards gap 10–14px.
- **Breakpoints:** `≥1280` full layout · `1024–1279` sidebar auto-collapses to rail, forms 2-col · `768–1023` forms 1–2 col, tables horizontally scroll with pinned first column · `<768` mobile: bottom tab bar (Dashboard, Orders, Invoices, Pay, More), forms 1-col, tables become stacked cards.
- **Mobile priority modules:** Delivery tracking, Invoice download, Pay Now, Ticket raise — these are the on-the-go tasks; order creation is desktop-first.
- **Print styles:** invoice detail, statement, order confirmation get dedicated print CSS (A4).

---

## 6. Global UX Patterns

### 6.1 Data freshness & SAP sync semantics (P1/P7)

- Real-time reads (stock, credit) → `Live` indicator.
- Cached reads → `Synced <relative time>` in screen header.
- SAP down → amber page banner: "Showing last synced data from 09:42. Live updates paused." Writes → optimistic UI + `Pending sync` badge; on failure, item enters a visible "Sync issues" tray with retry.

### 6.2 Forms

- Validation: inline on blur, summarized on submit; rules generated from SAP types (length, NUMC digits-only, DATS date, CURR decimal(13,2)) plus domain validators (GSTIN regex + checksum, PAN `AAAAA9999A`, IFSC 11-char, PIN 6-digit).
- Server (SAP) errors map to fields where possible; otherwise a doc-level error card with the SAP message text and a support-ticket shortcut.
- Drafts: every multi-section form autosaves; `Save Draft` explicit button too.
- Destructive/irreversible actions (Submit order, Cancel order, Approve & Create in SAP) → confirmation dialog stating the SAP consequence ("This creates sales order in SAP immediately").

### 6.3 Tables & lists

Server-side pagination (25/50/100), column sort, filter bar with chips, saved views, date-range presets (Today / 7d / 30d / FY-Qx / Custom FY-aware — Indian FY Apr–Mar), export, empty states with next-step CTA ("No open orders — Browse catalogue").

### 6.4 Notifications

- Toasts: transient confirmations (4s).
- Bell inbox: order confirmed, quote received, delivery dispatched, invoice generated, payment posted, ticket updated, credit released — each deep-links.
- Email/WhatsApp mirrors per tenant notification policy (configured in admin).

### 6.5 Status vocabulary (canonical)

One enum set in `packages/domain/status.ts`; UI labels: Draft, Submitted, Pending Approval, Approved, Rejected, Open, Confirmed, Credit Hold, In Process, Picked, Packed, In Transit, Delivered, Partially Delivered, Invoiced, Overdue, Paid, Cleared, Disputed, Resolved, Closed. Each maps to a SAP status source (e.g. VBUK-GBSTK A/B/C) in the mapping layer — never in components.

---

## 7. Module-by-Module Screen Specifications

> Field-level truth = the reference file's SAP mapping tables. This section defines layout, behavior, and states per screen. Req codes: M mandatory · O optional · C conditional.

### 7.0 Customer Dashboard (home)

- **Hero band** (dark gradient): company name, SAP customer code, GSTIN, status + loyalty-tier chip; quick actions (Browse, New Order, Invoices, Pay Now, Support).
- **KPI row (4):** Open Orders (count + value), Pending Invoices (count + due), Available Credit (of limit, % utilised), Open Tickets (SLA countdown). Each KpiCard clicks through to its module with the filter pre-applied.
- **Two tables:** Recent Orders (Order / Item / Value / Status), Recent Invoices (Invoice / Order / Amount / Status) — 4–5 rows, `View all` links.
- States: first-visit empty (onboarding-complete welcome + "Place your first order" CTA); credit-hold alert banner if any order blocked.

### 7.1 Customer Onboarding (accent `#5b21b6`)

4-step `WizardShell` (public, pre-auth beyond email verification):

1. **Company Information** — sections: Company Identity (NAME1, NAME2, KTOKD), Billing Address (STRAS, ORT01, REGIO→ drives GST place-of-supply hint, PSTLZ, LAND1 default IN), Primary Contact (ANSPK, SMTP_ADDR = future login, TELF1). 3-col grid.
2. **Tax & Regulatory** — PAN (STCD3, format-validated), GSTIN (STCD2, **live GSTN API verify**: spinner → verified tick with legal name echo → mismatch warning), GST Reg Type, CIN, TAN, Udyam. GSTIN verify result must match Step-1 state code; mismatch blocks continue with explanation.
3. **Credit & Commercial** — requested KLIMK, ZTERM, VKBUR; bank details (KOINH/BANKN/IFSC) marked "for refunds only".
4. **Documents & Approval** — uploads (PAN copy M, GST cert M, Incorporation O) via `FileUpload`; then read-only "what happens next" panel.

**Submission →** `/register/status`: timeline (Submitted → Under review → Approved/Rejected), email notifications. Rejected shows reasons + re-apply with data pre-filled.
**Internal approval screen** (back-office): applicant summary, document viewer, GSTN verification evidence, assign VKORG/VTWEG, credit decision; actions Request More Info / Reject (reason mandatory) / **Approve & Create in SAP** (calls BAPI, shows created KUNNR, triggers credential email). `DecisionGate` semantics from reference.

### 7.2 Product Catalogue (accent `#1d4ed8`)

- **Browse:** filter rail (search MATNR/MAKTX, category MATKL, plant WERKS) + card grid or table toggle. Product card: image, MATNR (mono), MAKTX, **customer-specific price** (KONP PR00) with "your price" label, stock chip (In stock n / Low / Out — from MARD-LABST + plant), MEINS, qty stepper + Add to Cart. Price and stock lazily loaded per card with skeletons (they're per-customer SAP calls).
- **Product detail:** gallery + spec sheet download (GOS), price breaks if any, MOQ (MVKE-MINBM) enforcement on stepper, plant-wise stock table, "Request quote" for large qty.
- **Price List tab:** condition-record validity (KNUMH, DATAB–DATBI), discount % (K007), downloadable PDF/XLSX.
- **Cart** (persistent drawer): line edit, MOQ/stock warnings, split CTA — Request Quote vs Create Order (per PRD both paths allowed).

### 7.3 Inquiry & Quotation (accent `#0e7490`)

- **Raise Inquiry:** header (type IN fixed, VDATU required-date picker ≥ today+lead-time, validity days) + line-item editor (material combobox from catalogue, KWMENG, VRKME auto) + notes (TDLINE, 2000 chars w/ counter). Draft/Submit.
- **Inquiry list → Quotation received:** notification + list state change.
- **View Quotation:** doc header (VBELN, dates, **Valid Until** with countdown chip amber <72h), line table (material, qty, NETPR, MWSK1, line total), totals card (net + GST breakup + gross NETWR). Actions: **Request Revision** (comment dialog → sales) · **Accept & Convert to Order** (confirm dialog: "Creates sales order in SAP with reference to this quotation") → redirects to created order. Expired quote → actions disabled + "Request revalidation".

### 7.4 Sales Order Management (accent `#15803d`)

- **Create Order:** 3 sections per reference — Header (BSTNK customer PO ref, VDATU, ship-to selector VBPA-SH from saved addresses), Line Items (repeatable rows; NETPR pre-filled read-only if from quotation; WERKS auto), Terms (ZTERM default from KNVV, INCO1, LPRIO). Sticky footer: **Check Availability (ATP)** → per-line confirmed qty/date chips (green full / amber partial with proposed schedule lines) · **Submit Order**.
- **Order detail / Status:** `O2CTimeline` on top; status cards: GBSTK overall, **CMGST credit status** (Blocked → prominent danger card: "Order on credit hold — our credit team is reviewing", with credit-position link), confirmed qty/date (VBEP), order-confirmation PDF download (BA00 output). Actions: Request Change (creates ticket-backed change request), Cancel (only while GBSTK=A, confirm dialog), Track Delivery.
- **Orders list:** DataTable with status filter chips mirroring dashboard.

### 7.5 Delivery & Tracking (accent `#0891b2`)

- **Track:** shipment card — status stepper Not Started → Picked → Packed → Shipped → Delivered (WBSTK + PGI events), planned vs actual GI dates, carrier (TDLNR), AWB (TRAID, external tracking link), **E-Way Bill badge** (J_1IEWB_NO, mandatory >₹50k — download PDF). Map/ETA optional P2.
- **POD:** received-qty per line (LFIMG, pre-filled = dispatched, editable), receipt date, discrepancy notes (portal field), signed-POD upload. **Confirm Receipt** (green) vs **Report Discrepancy** (auto-creates Support ticket category=Delivery, links delivery doc — reference gate). Qty mismatch auto-flags discrepancy flow.

### 7.6 Billing & Invoices (accent `#b45309`)

- **Invoice list:** filters (date FY-aware, status Open/Overdue/Paid), aging chip per row.
- **Invoice detail:** document header (VBELN, FKDAT, linked SO/delivery links), line table, **tax card**: taxable NETWR + CGST/SGST _or_ IGST split (place-of-supply logic surfaced: "Inter-state — IGST 18%"), gross total; **ComplianceBadge IRN** (truncated hash, copy, QR modal); due date (ZFBDT + terms) with days-left/overdue chip. Actions: Download Invoice PDF · Download e-Invoice (IRN JSON/PDF) · **Raise Dispute** (→ ticket category Billing, invoice linked) · Pay Now (→ payments with invoice pre-selected).
- **Credit/Debit Notes tab:** list (FKART G2/L2 badge, reason MGAGR, amount, original-invoice link).

### 7.7 Payments & Statement (accent `#be123c`)

- **Account Statement:** date-range + doc-type filters (RV/DZ/G2), running table Debit/Credit/Balance (BSEG/BSID), clearing status per row (Open/Cleared with AUGBL link), closing balance card, `AmountAging` bar. Export XLSX/PDF.
- **Make Payment:** step 1 — open-invoice multi-select table (checkboxes, amounts, due dates, overdue highlighted; partial-amount input per invoice); step 2 — summary + mode (UPI/NEFT/Card/NetBanking); step 3 — gateway redirect/modal; return states: **Success** (receipt page: gateway ref KIDNO, posted note "Payment recorded, clearing in SAP", printable) / **Pending** (polling banner) / **Failed** (retry, no double-charge copy). Statement row appears with `Pending sync` until F-28 posting confirms.

### 7.8 Service & Support (accent `#be185d`)

- **Raise Ticket:** category (QMART — Delivery/Quality/Billing/Product/General; pre-filled when arriving from POD/invoice dispute), related doc reference (optional, validated), priority (PRIOK with SLA hint per level), subject (QMTXT 40 chars), description (rich text 2000), attachments.
- **Track:** list + detail with status timeline (Open → In Progress → Resolved → Closed), assigned person, threaded comments, resolution notes, **SLA countdown chip** (amber <25% remaining, red breached), Reopen (within 7 days of resolve), Rate Resolution (1–5 stars + comment).

### 7.9 Loyalty & Credit (accent `#9333ea`)

- **Credit Position:** gauge/donut — limit KLIMK, utilized SKFOR, available (computed); credit status; DSO metric; utilization >80% amber, >95% danger with "orders may be blocked" warning. **Request Credit Limit Increase** → form (requested amount + justification) → approval-tracked request.
- **Loyalty & Rebates:** tier card (Bronze/Silver/Gold/Platinum) with progress bar to next threshold, YTD purchase (from VBRK, FY-aware), rebate agreement (KONA KNUMA), accrued rebate KAWRT, rebate statement download.

### 7.10 Reports & Analytics (accent `#ea580c`)

- **Sales Dashboard:** KPI row (YTD purchase, open orders, pending invoices, OTD%); charts — orders by month (12-mo bar), top products (horizontal bar, value/qty toggle), AOV trend. All widgets: skeleton, empty, error states; data-as-of timestamp.
- **AR Summary:** `AmountAging` buckets + drill-down table per bucket → invoice links. Export/schedule (email PDF weekly — P1).
- Charts: Recharts, module-accent primary series, max 2 series per chart, always labeled axes + INR formatting.

---

## 8. Cross-Cutting Screens

- **Auth:** login (email + password, tenant-branded), MFA (per tenant policy), forgot/reset, account switcher (multi sold-to), first-login forced password change.
- **Errors:** 403 (no permission — contact your admin), 404 (doc not found or wrong tenant — never leak existence), 500 (retry + reference ID), SAP-unavailable banner (§6.1), maintenance page.
- **Tenant back-office** (same shell, denser): onboarding approval queue, quotation workbench, credit release queue (blocked orders w/ exposure context), ticket workbench (SLA-sorted), tenant settings (branding: logo + primary color with contrast check; notification policy; user management).
- **Empty tenant/first-run** states for every module.

---

## 9. Accessibility (WCAG 2.1 AA)

- Color contrast ≥4.5:1 text, ≥3:1 UI; status never conveyed by color alone (icon/label always).
- Full keyboard: logical tab order, visible focus ring (2px primary offset), Esc closes layers, ⌘K palette, table row navigation with arrows + Enter.
- Semantics: real `<table>`, `<nav>`, landmarks; form fields with `<label for>`; errors via `aria-describedby` + `aria-live=polite`; toasts `role=status`.
- Touch targets ≥44px on mobile; charts get data-table fallback toggle.
- Language: `lang=en-IN`; number formats en-IN.

---

## 10. Interaction & Motion

- Durations: micro 120–150ms (hover/press), layer 200–250ms (dialogs, drawers), page skeleton crossfade 150ms. Easing `cubic-bezier(0.2,0,0,1)`.
- `prefers-reduced-motion` honored globally.
- No decorative animation; motion only communicates causality (drawer from trigger side, toast slide, stepper progress fill).

---

## 11. Content & Microcopy

- Voice: professional, direct, second person. No jargon leakage: users see "Order confirmation", not "BA00 output" (SAP terms appear only in spec-mode footers and admin screens).
- Dates: `02-Jun-25` display, ISO in APIs. Money: `₹ 4,80,000` (en-IN grouping). SAP doc numbers shown without leading zeros.
- Error copy pattern: what happened + what it means + what to do. Ex: "GSTIN state (29 — Karnataka) doesn't match your billing state (27 — Maharashtra). Update the billing address or check the GSTIN."
- Confirmation copy always names the SAP consequence for write actions.

---

## 12. Design-to-Dev Handoff Conventions

1. **Field mapping registry** (`packages/domain/sap-mapping/*.ts`) is the single source for label, SAP table/field, type, length, required — screens and validation are generated from it; this doc and the reference tables seed it.
2. **Status registry** (§6.5) — single mapping from SAP raw codes → canonical status → UI badge.
3. **Storybook** is the acceptance surface for components; a screen isn't "done" until its loading/empty/error/stale states exist.
4. Naming: screens = route names; components PascalCase matching §3.2; tokens kebab-case CSS vars.
5. Any new screen must declare: route, role visibility, SAP data sources + freshness class (live/cached/queued-write), and its place on the O2C timeline (if document-bearing).
