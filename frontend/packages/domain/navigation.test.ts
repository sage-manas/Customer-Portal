import { describe, expect, it } from "vitest";

import { activeNavItem, visibleNavItems, type NavItem } from "./navigation";

const ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/", icon: "LayoutDashboard", permission: "dashboard:view", status: "live" },
  { key: "orders", label: "Orders", href: "/orders", icon: "ShoppingCart", permission: "order:view", status: "live" },
  { key: "admin", label: "Admin", href: "/admin", icon: "ShieldCheck", permission: "admin:view", status: "live" },
];

describe("visibleNavItems", () => {
  it("filters to what the session's roles permit", () => {
    const visible = visibleNavItems(ITEMS, { roles: ["customer"] });
    expect(visible.map((item) => item.key)).toEqual(["dashboard", "orders"]);
  });

  it("hides a permitted item when the tenant has toggled its module off", () => {
    const visible = visibleNavItems(ITEMS, { roles: ["customer"] }, { orders: false });
    expect(visible.map((item) => item.key)).toEqual(["dashboard"]);
  });

  it("treats an absent toggle as enabled", () => {
    const visible = visibleNavItems(ITEMS, { roles: ["customer"] }, {});
    expect(visible.map((item) => item.key)).toContain("orders");
  });

  it("returns nothing for a session with no matching permissions", () => {
    expect(visibleNavItems(ITEMS, { roles: [] })).toEqual([]);
  });
});

describe("activeNavItem", () => {
  it("matches the longest prefix, so a detail route highlights its list item", () => {
    expect(activeNavItem(ITEMS, "/orders/4711")?.key).toBe("orders");
  });

  it("matches the dashboard only at the exact root", () => {
    expect(activeNavItem(ITEMS, "/")?.key).toBe("dashboard");
    expect(activeNavItem(ITEMS, "/orders")?.key).not.toBe("dashboard");
  });

  it("returns undefined for an unknown route rather than falling back", () => {
    expect(activeNavItem(ITEMS, "/reports/ar")).toBeUndefined();
  });
});
