/**
 * The RBAC route matrix (MIGRATION-PHASE-1.md section 3): which role sees
 * which route, and how to judge a navigation's outcome against it.
 *
 * Split out of 01-route-sweep.mjs so it can be imported both by that
 * standalone script (`node scripts/qa/01-route-sweep.mjs`) and by
 * e2e/route-sweep.spec.ts -- the Playwright-run promotion of the same sweep
 * (REMEDIATION-PLAN §7 Tier 3). This file is free of `import.meta`, which is
 * what lets Playwright's CJS test loader import it without choking.
 */

export const ROLES = ["customer", "client_admin", "ap_manager", "ar_manager", "super_admin", "sap_manager"];

// Routes grouped exactly as the documented matrix groups them.
export const GROUPS = [
  {
    label: "/  (and portal routes: catalogue, inquiries, quotations, orders, deliveries, invoices, payments, support, account, reports)",
    paths: [
      "/",
      "/catalogue",
      "/catalogue/MAT-10001",
      "/catalogue/price-list",
      "/inquiries",
      "/inquiries/new",
      "/inquiries/0010000801",
      "/quotations",
      "/quotations/0020000901",
      "/orders",
      "/orders/new",
      "/orders/0000004711",
      "/deliveries",
      "/deliveries/0080001901",
      // 0080001901 is already POD-confirmed in seed data (podConfirmed:
      // true), so this route bounces back to the delivery detail page —
      // asserted separately below, not lumped into the "ok" group.
      "/invoices",
      "/invoices/notes",
      "/invoices/0090002211",
      "/payments",
      "/payments/pay",
      "/support",
      "/support/new",
      "/account",
      "/account/loyalty",
      "/account/credit/request",
      "/reports",
      "/reports/ar",
    ],
    expect: {
      customer: "ok",
      client_admin: "plane-redirect", // -> /admin
      ap_manager: "plane-redirect",
      ar_manager: "plane-redirect",
      super_admin: "plane-redirect", // -> console
      sap_manager: "plane-redirect",
    },
  },
  {
    label: "/admin",
    paths: ["/admin"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "ok", ar_manager: "ok", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/admin/onboarding*",
    paths: ["/admin/onboarding"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "404", ar_manager: "404", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/admin/credit",
    paths: ["/admin/credit"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "403", ar_manager: "403", super_admin: "403", sap_manager: "403" },
  },
  {
    // Documented pre-existing limitation (MIGRATION-PHASE-1.md §8.3): the
    // page guard here checks only `admin:view`, matching /client's own
    // source pages, which carry no finer guard either. ap_manager and
    // ar_manager can reach it directly by URL even though the nav item
    // (permission `quotation:issue`) hides the link from them.
    label: "/admin/quotations",
    paths: ["/admin/quotations"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "ok", ar_manager: "ok", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/admin/customers*",
    paths: ["/admin/customers", "/admin/customers/new", "/admin/customers/0010001001"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "404", ar_manager: "404", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/admin/ap",
    paths: ["/admin/ap"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "ok", ar_manager: "403", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/admin/ar",
    paths: ["/admin/ar"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "403", ar_manager: "ok", super_admin: "403", sap_manager: "403" },
  },
  {
    // ADR-060 (packages/domain/navigation.ts comment): the standalone
    // Exceptions tab was folded into the AP workspace in Phase 6, and the
    // route is now a redirect-only stub rather than "ok" on its own URL.
    label: "/admin/exceptions",
    paths: ["/admin/exceptions"],
    expect: { customer: "403", client_admin: "exceptions-redirect", ap_manager: "exceptions-redirect", ar_manager: "403", super_admin: "403", sap_manager: "403" },
  },
  {
    // Same documented limitation as /admin/quotations: the guard checks
    // only `admin:view`, not `support:resolve`.
    label: "/admin/tickets*",
    paths: ["/admin/tickets"],
    expect: { customer: "403", client_admin: "ok", ap_manager: "ok", ar_manager: "ok", super_admin: "403", sap_manager: "403" },
  },
  {
    label: "/tenants*, /operators, /billing",
    paths: ["/tenants", "/tenants/new", "/tenants/tenant-acme", "/operators", "/billing"],
    expect: { customer: "403", client_admin: "403", ap_manager: "403", ar_manager: "403", super_admin: "ok", sap_manager: "403" },
  },
  {
    label: "/sap/config*, /sap/health",
    paths: ["/sap/config", "/sap/config/tenant-acme", "/sap/health"],
    expect: { customer: "403", client_admin: "403", ap_manager: "403", ar_manager: "403", super_admin: "ok", sap_manager: "ok" },
  },
];

export const PLANE_LANDING = {
  customer: "/",
  client_admin: "/admin",
  ap_manager: "/admin",
  ar_manager: "/admin",
  super_admin: "/tenants",
  sap_manager: "/sap/config",
};

export function matches(actual, expected, roleKey) {
  if (expected === "ok") return actual.outcome === "ok";
  if (expected === "403") return actual.outcome === "403";
  if (expected === "404") return actual.outcome === "404";
  if (expected === "plane-redirect") {
    return actual.outcome === "redirect" && actual.url === PLANE_LANDING[roleKey];
  }
  if (expected === "exceptions-redirect") {
    return actual.outcome === "redirect" && actual.url === "/admin/ap";
  }
  return false;
}
