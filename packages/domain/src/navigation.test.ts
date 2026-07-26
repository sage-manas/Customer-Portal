import { describe, expect, it } from "vitest";

import { PERMISSIONS, type Role } from "./auth";
import { ADMIN_NAV, PORTAL_NAV, activeNavItem, visibleNavItems } from "./navigation";

const session = (...roles: Role[]) => ({ roles });

describe("nav registry", () => {
  it("references only real permissions", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const item of [...PORTAL_NAV, ...ADMIN_NAV]) {
      expect(known.has(item.permission), item.key).toBe(true);
    }
  });

  it("has unique keys and hrefs", () => {
    const items = [...PORTAL_NAV, ...ADMIN_NAV];
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
  it("shows a buyer the portal modules but no back-office ones", () => {
    const visible = visibleNavItems(PORTAL_NAV, session("buyer_user"));
    expect(visible.map((i) => i.key)).toContain("orders");
    expect(visibleNavItems(ADMIN_NAV, session("buyer_admin"))).toEqual([]);
  });

  it("shows the credit team only its own queue", () => {
    const visible = visibleNavItems(ADMIN_NAV, session("tenant_credit")).map((i) => i.key);
    expect(visible).toContain("admin-credit");
    expect(visible).not.toContain("admin-settings");
    expect(visible).not.toContain("admin-tickets");
  });

  it("hides modules a tenant has toggled off, and keeps absent toggles on", () => {
    const visible = visibleNavItems(PORTAL_NAV, session("buyer_user"), { support: false });
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
