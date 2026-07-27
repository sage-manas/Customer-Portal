import type { Permission, SessionClaims } from "./auth";
import { hasPermission } from "./auth";

/**
 * Navigation registry — the single source for the sidebar, per
 * docs/05-UI-UX-DESIGN.md §4.1 (sitemap) and §4.2 (nav model: modules in
 * O2C order, module-accent highlight on the active item).
 *
 * The Sidebar component renders whatever this exports; it does not carry
 * its own list of routes, icons, accents or permission checks. Adding a
 * module = adding a row here.
 */

/** Keys of moduleAccentTokens in @cc/ui — kept as a string union so the
 * domain layer stays free of any UI import (CLAUDE.md rule 1). */
export type ModuleAccent =
  | "onboard"
  | "catalog"
  | "inquiry"
  | "order"
  | "delivery"
  | "invoice"
  | "payment"
  | "support"
  | "loyalty"
  | "report";

/** Lucide icon name (docs/05 §2.2). Resolved to a component in @cc/ui. */
export type NavIcon =
  | "LayoutDashboard"
  | "ShoppingCart"
  | "FileText"
  | "FileSignature"
  | "Package"
  | "Truck"
  | "Receipt"
  | "CreditCard"
  | "Headphones"
  | "Award"
  | "TrendingUp"
  | "FileCheck"
  | "ShieldCheck"
  | "Settings";

export interface NavItem {
  /** Stable key; also the tenant module-toggle key (Tenant.moduleToggles). */
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  accent?: ModuleAccent;
  /** Permission required to see *and* to call the underlying API. */
  permission: Permission;
  /**
   * Whether the module is actually built yet. The sidebar renders planned
   * items disabled rather than hiding them — doc 05 §4.2 fixes the module
   * order, and a nav that silently changes shape phase to phase is worse
   * for the pilot tenants than one that shows what's coming.
   */
  status: "live" | "planned";
}

/** Customer-facing portal nav, in O2C order (docs/05 §4.1). */
export const PORTAL_NAV: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    icon: "LayoutDashboard",
    permission: "dashboard:view",
    status: "live",
  },
  {
    key: "catalogue",
    label: "Catalogue",
    href: "/catalogue",
    icon: "ShoppingCart",
    accent: "catalog",
    permission: "catalogue:view",
    status: "planned",
  },
  {
    key: "inquiries",
    label: "Inquiries",
    href: "/inquiries",
    icon: "FileText",
    accent: "inquiry",
    permission: "inquiry:view",
    status: "planned",
  },
  {
    key: "quotations",
    label: "Quotations",
    href: "/quotations",
    icon: "FileSignature",
    accent: "inquiry",
    permission: "quotation:view",
    status: "planned",
  },
  {
    key: "orders",
    label: "Orders",
    href: "/orders",
    icon: "Package",
    accent: "order",
    permission: "order:view",
    status: "planned",
  },
  {
    key: "deliveries",
    label: "Deliveries",
    href: "/deliveries",
    icon: "Truck",
    accent: "delivery",
    permission: "delivery:view",
    status: "planned",
  },
  {
    key: "invoices",
    label: "Invoices",
    href: "/invoices",
    icon: "Receipt",
    accent: "invoice",
    permission: "invoice:view",
    status: "planned",
  },
  {
    key: "payments",
    label: "Payments",
    href: "/payments",
    icon: "CreditCard",
    accent: "payment",
    permission: "payment:view",
    status: "planned",
  },
  {
    key: "support",
    label: "Support",
    href: "/support",
    icon: "Headphones",
    accent: "support",
    permission: "support:view",
    status: "planned",
  },
  {
    key: "account",
    label: "Account",
    href: "/account",
    icon: "Award",
    accent: "loyalty",
    permission: "account:view",
    status: "planned",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: "TrendingUp",
    accent: "report",
    permission: "report:view",
    status: "planned",
  },
] as const;

/** Tenant back-office nav (docs/05 §8). Same shell, denser layout. */
export const ADMIN_NAV: readonly NavItem[] = [
  {
    key: "admin-overview",
    label: "Overview",
    href: "/admin",
    icon: "LayoutDashboard",
    permission: "admin:view",
    status: "live",
  },
  {
    key: "admin-onboarding",
    label: "Onboarding Queue",
    href: "/admin/onboarding",
    icon: "FileCheck",
    accent: "onboard",
    permission: "onboarding:review",
    status: "live",
  },
  {
    key: "admin-quotations",
    label: "Quotation Workbench",
    href: "/admin/quotations",
    icon: "FileSignature",
    accent: "inquiry",
    permission: "quotation:issue",
    status: "planned",
  },
  {
    key: "admin-credit",
    label: "Credit Release",
    href: "/admin/credit",
    icon: "ShieldCheck",
    accent: "payment",
    permission: "credit:release",
    status: "planned",
  },
  {
    key: "admin-tickets",
    label: "Ticket Workbench",
    href: "/admin/tickets",
    icon: "Headphones",
    accent: "support",
    permission: "support:resolve",
    status: "planned",
  },
  {
    key: "admin-settings",
    label: "Tenant Settings",
    href: "/admin/settings",
    icon: "Settings",
    permission: "tenant:settings",
    status: "planned",
  },
] as const;

/**
 * Filters a nav list for one session: RBAC first (docs/05 §4.3), then the
 * tenant's module toggles (docs/02 §2 tenant config store). An absent
 * toggle means "enabled" — tenants opt modules *out*, not in.
 */
export function visibleNavItems(
  items: readonly NavItem[],
  session: Pick<SessionClaims, "roles"> | null | undefined,
  moduleToggles: Record<string, boolean> = {},
): NavItem[] {
  return items.filter(
    (item) => hasPermission(session, item.permission) && moduleToggles[item.key] !== false,
  );
}

/**
 * Longest-prefix match of a pathname to its nav item, so `/orders/4711`
 * highlights "Orders". Returns undefined on unknown routes rather than
 * falling back to Dashboard — a wrong highlight is worse than none.
 */
export function activeNavItem(items: readonly NavItem[], pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const isMatch = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    if (!isMatch) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best;
}
