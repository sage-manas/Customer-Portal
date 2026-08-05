# 11 — Completeness & Gap Analysis

Version 1.0 · 2026-07-26 · Based on a direct read of the codebase (not the docs). Companion to docs 00–10.

---

## 0. Executive summary

The codebase is materially further along than doc 07 recorded. All ten modules exist as services with routes and tests; the five-tier RBAC is implemented; `apps/ops` has tenants, SAP config, SAP health, operators and billing; `packages/observability`, `packages/adapters/cache`, `billing`, `notifications`, and a Razorpay driver all exist; 88 test files and 12 Playwright specs are present.

What remains is **not** "more modules". It is four things:

1. **Dead ends in the nav and shell** — declared tabs with no page, account areas that don't exist.
2. **Identity hygiene** — no password reset, no MFA, no CSRF defence, no user-management UI. This is the single biggest production blocker and it is invisible from a feature list.
3. **Compliance generation** — IRN and e-way bill are _read through_ from mock SAP; nothing _generates_ them. No `einvoice`/`eway` adapters exist. For an India GST product this is a core promise, not an integration nicety.
4. **Role depth** — each role has its entry screens, but several roles are missing the day-2 workflows that make them usable (AP has no dispute/return handling, AR has no dunning, sap_manager has no diagnostics beyond health, customer has no profile/users/addresses).

Below: per-layer gaps, then per-role gaps, then a prioritised backlog.

---

## 1. Structural gaps (verified in code)

### 1.1 Nav items with no destination

`NAV_ITEMS` declares `/admin/settings` (`tenant:settings`) but `apps/web/app/(admin)/admin/settings` does not exist. A `client_admin` sees a tab that 404s. **Add a test that asserts every nav `href` resolves to a route** — this class of bug should be impossible, not fixed once.

### 1.2 Missing screens behind existing permissions

| Permission             | Screen that should exist                                                                                                                                         | Status     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `tenant:settings`      | `/admin/settings` — branding (logo, primary colour w/ contrast check), module toggles, notification policy, FY config, SLA overrides, loyalty thresholds         | ⬜ Missing |
| `account:manage-users` | `/account/users` — customer-side user invite/disable/role                                                                                                        | ⬜ Missing |
| `account:view`         | `/account/profile` (company master, read-mostly from SAP) and `/account/addresses` (ship-to list, VBPA)                                                          | ⬜ Missing |
| `admin:view`           | Admin-side order register, delivery register, catalogue view, admin reports — back office currently has no read-across of the documents it supports customers on | ⬜ Missing |
| `customer:edit`        | Customer detail exists; a per-customer 360 (orders, invoices, open items, tickets, credit in one place) does not                                                 | ⬜ Missing |

### 1.3 Event registry has holes

`DOMAIN_EVENTS` covers order.created, quotation._, payment.posted, delivery.receipt.confirmed, credit._, support.*. **Missing events that users expect notifications for:** `order.confirmed`, `order.credit-blocked`, `order.cancelled`, `delivery.dispatched` (the single most-wanted notification in B2B), `invoice.created`, `invoice.overdue`, `payment.failed`, `onboarding.approved`/`rejected`, `customer.deactivated`. Delivery discrepancy exists as an event but has no notification template.

### 1.4 Adapters

| Adapter         | State                                                    | Gap                                                                                           |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| sap             | mock complete; `ecc`/`s4` are `NotImplemented` skeletons | Real drivers (Track C) — expected                                                             |
| gstn            | mock only                                                | Live GSP driver                                                                               |
| **einvoice**    | **does not exist**                                       | IRN generation, QR, cancel window, IRN-failure exception queue                                |
| **eway**        | **does not exist**                                       | Generation at PGI, part-B update, cancel/extend, distance/validity rules                      |
| payment-gateway | mock + razorpay driver                                   | Refund path, settlement reconciliation file ingestion, second gateway                         |
| notifications   | log + email                                              | SMS and WhatsApp drivers (India B2B runs on WhatsApp), per-tenant channel policy, quiet hours |
| storage         | memory/local/s3                                          | Virus scan hook, signed-URL expiry policy, retention                                          |
| cache, billing  | present                                                  | Billing is a stub — no metering→invoice→dunning for tenants                                   |

### 1.5 Security & identity (highest risk cluster)

- **No password reset / forgot-password flow.** Users locked out have no path.
- **No MFA/TOTP**, no SSO (SAML/OIDC) for tenant staff — TRD §3 calls for both.
- **No CSRF protection** found on cookie-authenticated mutating routes.
- No account lockout / brute-force throttle on login (rate limiting exists at middleware but verify it covers auth specifically).
- No session revocation list (logout-everywhere, force-logout on role change beyond the claim-version bump).
- No password policy / rotation for the credentials mailed by back-office registration.
- No PII field-level encryption or data-retention/erasure (DPDP Act 2023 obligations: consent record, purpose limitation, erasure request handling, breach notification readiness).
- No security headers policy (CSP, HSTS, frame-ancestors) verified.

### 1.6 Quality & operations

- No accessibility testing (`axe`) anywhere, despite doc 05 §9 committing to WCAG 2.1 AA.
- No i18n scaffolding — hardcoded English strings; Indian B2B often needs Hindi + regional at minimum for the customer plane.
- No load/performance testing, no bundle budget, no DB query-performance guard (N+1 risk is high in SAP-composing services).
- No runbooks, DR/backup-restore drill, status page, SLA definition.
- No API versioning or public API/webhooks for tenants who want ERP-adjacent integration.
- Mobile: layouts exist but no verified mobile pass (doc 05 §5 promised bottom-tab mobile shell — not found).

---

## 2. Per-role completeness

### 2.1 `super_admin` (ops)

**Has:** tenant CRUD, tenant status, SAP config + test, SAP health, operators CRUD, billing page.
**Missing:**

- Tenant lifecycle beyond create/deactivate: **suspend vs terminate**, data export on offboarding, tenant clone/template for fast provisioning, trial→paid transition.
- **Impersonation / support-access** ("view as tenant admin") with a mandatory reason + audit trail — the single most requested operator capability, and dangerous without a strict audit design.
- **Global audit explorer** — `AuditLog` and `SapConfigAudit` exist as tables but there's no cross-tenant search UI.
- **Platform health**: queue depth, worker liveness, outbox backlog, error rates, per-tenant request volume in one dashboard (health exists per SAP, not per platform).
- Module/feature-flag toggles per tenant (nav reads `moduleToggles` — no UI to set them).
- Metering → billing: usage counters, plan limits, overage, invoice generation (billing adapter is a stub).
- Announcements/maintenance banners pushed to tenants; per-tenant notification of planned downtime.
- Operator MFA (platform plane must be the _most_ protected and currently isn't).

### 2.2 `sap_manager` (ops)

**Has:** per-tenant SAP config, test connection, health dashboard, config audit.
**Missing:**

- **Connection diagnostics beyond a boolean**: latency percentiles, error taxonomy (auth vs network vs BAPI error), last N failed calls with payload/response, retry.
- **Field-mapping overrides per tenant** — the TRD promises tenant-level mapping customisation; the registry is global today. A SAP manager should be able to remap e.g. a Z-field without a code change.
- **Sandbox vs production config per tenant** with a promotion flow and a "dry-run against sandbox" action.
- **Contract conformance suite**: run the adapter test battery against a tenant's real SAP and get a pass/fail report per contract method — this is what makes onboarding a new tenant's SAP a day, not a month.
- Sync/replay tools: re-drive a failed SAP write, inspect the outbox for SAP-caused failures (exception tray is tenant-side, not ops-side).
- Credential rotation UI + expiry warnings.
- Rate/quota configuration per tenant SAP (protect a small ECC from portal traffic).

### 2.3 `client_admin` (tenant)

**Has:** onboarding queue + approve/reject/request-info, customers CRUD + back-office registration, quotations workbench, credit desk, tickets workbench, AP/AR entry (via union of permissions).
**Missing:**

- **`/admin/settings`** — the tab exists and the page does not (branding, module toggles, notification policy, SLA/loyalty overrides, FY, payment-terms defaults).
- **Tenant user management** — inviting/managing their own staff (ap_manager, ar_manager users) has no UI at all. This blocks the role model from being usable by a real tenant.
- **Customer 360** view; customer-user management (which portal users belong to which KUNNR, resend credentials, unlock).
- Bulk operations: bulk customer import (CSV → registration), bulk price-list publish, bulk ticket assignment.
- Admin read-across registers: orders, deliveries, invoices across all customers with filters (today the back office can approve onboarding but can't browse its own order book).
- Approval delegation / out-of-office, and multi-step approval policy config (who approves above ₹X).
- Catalogue curation: which materials are visible to which customer segment, featured products, per-customer catalogue restriction.
- Announcement banner to their customers; document templates (T&Cs on order confirmation).
- Tenant-level audit trail view (AuditLog exists, no UI).

### 2.4 `ap_manager` (tenant)

**Has:** rebates list + settle, refunds, gateway reconciliation/exceptions tray.
**Missing:**

- **Credit/debit note creation workflow** — the customer can raise a dispute; there is no AP-side flow to evaluate it and issue a G2/L2 note in SAP.
- **Returns / RMA** — the whole returns loop (return request → approval → return delivery → credit note) is absent from the product, yet it is where most B2B disputes live.
- Refund lifecycle beyond a queue: approval thresholds, gateway refund execution, partial refunds, refund failure handling.
- Settlement file ingestion and matching (gateway payout ↔ bank statement ↔ SAP clearing).
- Vendor-side rebate accrual reporting and period settlement calendar.
- AP aging/exception KPIs and an AP dashboard (there is no AP home).

### 2.5 `ar_manager` (tenant)

**Has:** credit-block queue with release, and the AR workspace shell.
**Missing:**

- **Dunning** — overdue ladder, reminder scheduling, escalation, promise-to-pay tracking. Named in doc 09, not built.
- **Payment allocation / matching UI** — when a customer pays a lump sum, someone must allocate it across open items; today allocation only happens on the customer-initiated path.
- Manual/offline payment recording (NEFT received in bank, not through the gateway) — a large share of Indian B2B collections.
- Collections dashboard: DSO trend, aging by customer, at-risk accounts, collector worklist.
- Customer statement generation + scheduled email dispatch.
- Write-off / bad-debt marking with approval.
- Interest/late-fee rules on overdue invoices.

### 2.6 `customer` (portal)

**Has:** catalogue, cart, inquiries, quotations, orders + drafts, deliveries + POD, invoices + notes, payments, support, loyalty, credit request, reports, notifications bell.
**Missing:**

- **Account area is a shell**: no company profile, no ship-to address management, no user management (`account:manage-users` has no page), no notification preferences.
- **Reorder / order templates / scheduled orders** — the highest-value convenience feature in B2B repeat purchasing.
- **Order change request** after submission (doc 05 §7.4 specifies it; only cancel exists).
- **Returns request** (see AP).
- **Invoice dispute** flow end-to-end (dispute raises a ticket, but no dispute state on the invoice, no resolution path back).
- Saved carts / multiple carts, CSV quick-order pad, favourites/frequently-bought.
- Document downloads: order confirmation PDF, delivery challan, e-way bill PDF, consolidated statement (invoice PDF exists).
- Global search / ⌘K command palette across documents (doc 05 §4.2 promised it).
- Saved filters/views and bulk export on lists.
- Mobile experience pass (bottom-tab shell per doc 05 §5).
- Partial-payment UX, payment history with receipts, autopay/standing instruction.
- In-app help/onboarding tour, empty-state guidance.

---

## 3. Prioritised backlog

**P0 — blocks any real user (do first)**

1. `/admin/settings` page + nav-href integrity test.
2. Password reset, account lockout, CSRF on all cookie-auth mutations, security headers.
3. MFA (TOTP) — mandatory for ops plane, optional per tenant policy for staff.
4. Tenant user management (`/admin/users`) and customer user management (`/account/users`).
5. Missing lifecycle events + notification templates (dispatch, invoice, credit-block, onboarding decision, payment failure).

**P1 — completes the promised product** 6. `einvoice` + `eway` adapters (interface + mock first, GSP driver behind them), IRN/e-way exception queue, PDF/QR rendering. 7. AR: dunning + manual payment recording + allocation UI + collections dashboard. 8. AP: dispute → credit-note workflow; returns/RMA loop. 9. Customer: profile, addresses, reorder/templates, order change request, document downloads, dispute states. 10. Admin read-across registers (orders/deliveries/invoices) + customer 360.

**P2 — makes it excellent** 11. sap_manager depth: diagnostics, per-tenant field-mapping overrides, conformance suite, sandbox/prod promotion, credential rotation. 12. super_admin depth: impersonation with audit, platform health, module toggles UI, metering→billing, offboarding export. 13. Accessibility (axe in CI), mobile shell, ⌘K search, saved views, bulk actions/imports. 14. i18n scaffolding; WhatsApp/SMS notification drivers + channel policy. 15. Load tests, performance budgets, runbooks, DR drill, status page, public API + tenant webhooks.

**P3 — real-world integration (Track C, unchanged)** 16. ECC/S4 drivers against a design-partner sandbox; live GSTN/GSP; pilot.

---

## 4. Standing rules for all of the above

Everything here is built under the existing constitution: registries not duplication (new events, templates, settings, dunning rules and role permissions are all registry entries), ADR-016 (SAP owns the document — store only what SAP cannot hold), `runWithTenant` on every query, 404 not 403 across tenant/customer boundaries, adapter interface + mock before any real driver, and a green `turbo run typecheck lint test build` plus module Playwright spec before each phase closes.
