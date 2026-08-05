import { describe, expect, it } from "vitest";

import { PERMISSIONS, type Role } from "./auth";
import { ADMIN_NAV, OPS_NAV, PORTAL_NAV, activeNavItem, visibleNavItems } from "./navigation";

const session = (...roles: Role[]) => ({ roles });

describe("nav registry", () => {
  it("references only real permissions", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const item of [...PORTAL_NAV, ...ADMIN_NAV, ...OPS_NAV]) {
      expect(known.has(item.permission), item.key).toBe(true);
    }
  });

  it("has unique keys and hrefs", () => {
    const items = [...PORTAL_NAV, ...ADMIN_NAV, ...OPS_NAV];
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it("lists the customer modules in O2C order (docs/05 §4.1)", () => {
    expect(PORTAL_NAV.map((i) => i.key)).toEqual([
      "dashboard",
      "catalogue",
      "inquiries",
      "quotations",
      "orders",
      "deliveries",
      "invoices",
      "payments",
      "support",
      "account",
      "reports",
    ]);
  });
});

describe("visibleNavItems", () => {
  it("shows a customer the portal modules but no back-office or ops ones", () => {
    const visible = visibleNavItems(PORTAL_NAV, session("customer"));
    expect(visible.map((i) => i.key)).toContain("orders");
    expect(visibleNavItems(ADMIN_NAV, session("customer"))).toEqual([]);
    expect(visibleNavItems(OPS_NAV, session("customer"))).toEqual([]);
  });

  it("shows each finance desk its own workspace and not the other's", () => {
    const ap = visibleNavItems(ADMIN_NAV, session("ap_manager")).map((i) => i.key);
    const ar = visibleNavItems(ADMIN_NAV, session("ar_manager")).map((i) => i.key);
    expect(ap).toContain("admin-ap");
    // The exception tray is a view inside that workspace as of Phase 6
    // (ADR-060), so AP reaches it without a tab of its own.
    expect(ADMIN_NAV.map((i) => i.key)).not.toContain("admin-exceptions");
    expect(ap).not.toContain("admin-ar");
    expect(ar).toContain("admin-ar");
    expect(ar).not.toContain("admin-ap");
    for (const desk of [ap, ar]) {
      expect(desk).not.toContain("admin-customers");
      expect(desk).not.toContain("admin-settings");
    }
  });

  it("shows the tenant admin every admin tab", () => {
    const visible = visibleNavItems(ADMIN_NAV, session("client_admin")).map((i) => i.key);
    expect(visible).toEqual(ADMIN_NAV.map((i) => i.key));
  });

  it("shows the SAP manager exactly the two SAP tabs (doc 09 §3.3)", () => {
    expect(visibleNavItems(OPS_NAV, session("sap_manager")).map((i) => i.key)).toEqual([
      "ops-sap-config",
      "ops-sap-health",
    ]);
    expect(visibleNavItems(OPS_NAV, session("super_admin")).map((i) => i.key)).toEqual(
      OPS_NAV.map((i) => i.key),
    );
  });

  it("hides modules a tenant has toggled off, and keeps absent toggles on", () => {
    const visible = visibleNavItems(PORTAL_NAV, session("customer"), { support: false });
    expect(visible.map((i) => i.key)).not.toContain("support");
    expect(visible.map((i) => i.key)).toContain("invoices");
  });

  it("returns nothing without a session", () => {
    expect(visibleNavItems(PORTAL_NAV, null)).toEqual([]);
  });
});

describe("activeNavItem", () => {
  it("matches a detail route to its module by longest prefix", () => {
    expect(activeNavItem(PORTAL_NAV, "/orders/4711")?.key).toBe("orders");
    expect(activeNavItem(ADMIN_NAV, "/admin/onboarding/abc")?.key).toBe("admin-onboarding");
  });

  it("does not let the root item swallow every route", () => {
    expect(activeNavItem(PORTAL_NAV, "/")?.key).toBe("dashboard");
    expect(activeNavItem(PORTAL_NAV, "/invoices")?.key).toBe("invoices");
  });

  it("returns undefined for an unknown route rather than guessing", () => {
    expect(activeNavItem(PORTAL_NAV, "/nowhere")).toBeUndefined();
  });
});
