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
  | "Settings"
  | "AlertTriangle"
  | "Users"
  | "Building2"
  | "Activity"
  | "PlugZap"
  | "Landmark"
  | "Wallet";

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
    status: "live",
  },
  {
    key: "inquiries",
    label: "Inquiries",
    href: "/inquiries",
    icon: "FileText",
    accent: "inquiry",
    permission: "inquiry:view",
    status: "live",
  },
  {
    key: "quotations",
    label: "Quotations",
    href: "/quotations",
    icon: "FileSignature",
    accent: "inquiry",
    permission: "quotation:view",
    status: "live",
  },
  {
    key: "orders",
    label: "Orders",
    href: "/orders",
    icon: "Package",
    accent: "order",
    permission: "order:view",
    status: "live",
  },
  {
    key: "deliveries",
    label: "Deliveries",
    href: "/deliveries",
    icon: "Truck",
    accent: "delivery",
    permission: "delivery:view",
    status: "live",
  },
  {
    key: "invoices",
    label: "Invoices",
    href: "/invoices",
    icon: "Receipt",
    accent: "invoice",
    permission: "invoice:view",
    status: "live",
  },
  {
    key: "payments",
    label: "Payments",
    href: "/payments",
    icon: "CreditCard",
    accent: "payment",
    permission: "payment:view",
    status: "live",
  },
  {
    key: "support",
    label: "Support",
    href: "/support",
    icon: "Headphones",
    accent: "support",
    permission: "support:view",
    status: "live",
  },
  {
    key: "account",
    label: "Account",
    href: "/account",
    icon: "Award",
    accent: "loyalty",
    permission: "account:view",
    status: "live",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    icon: "TrendingUp",
    accent: "report",
    permission: "report:view",
    status: "live",
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
    status: "live",
  },
  {
    key: "admin-credit",
    /** Doc 05 §8 calls this the "credit release queue". A5 builds the desk's
     * other half — the credit-limit requests customers raise — so the label is
     * the desk rather than one of its queues; the blocked-order release queue
     * joins this screen when a tenant-wide read for it exists (see the
     * @cc/service-loyalty README). */
    label: "Credit Desk",
    href: "/admin/credit",
    icon: "ShieldCheck",
    accent: "payment",
    permission: "credit:decide-limit",
    status: "live",
  },
  {
    key: "admin-tickets",
    label: "Ticket Workbench",
    href: "/admin/tickets",
    icon: "Headphones",
    accent: "support",
    permission: "support:resolve",
    status: "live",
  },
  {
    key: "admin-customers",
    /** Doc 09 §3.4. Register/edit/deactivate lives behind `customer:register`
     * rather than a coarser `admin:view`: an AP or AR manager holds the shell
     * and must not see the customer master. */
    label: "Customers",
    href: "/admin/customers",
    icon: "Users",
    accent: "onboard",
    permission: "customer:register",
    status: "live",
  },
  {
    key: "admin-ap",
    label: "Accounts Payable",
    href: "/admin/ap",
    icon: "Wallet",
    accent: "payment",
    permission: "finance:ap",
    status: "live",
  },
  {
    key: "admin-ar",
    label: "Accounts Receivable",
    href: "/admin/ar",
    icon: "Landmark",
    accent: "invoice",
    permission: "finance:ar",
    status: "live",
  },
  /**
   * The Exceptions tab is deliberately gone: the tray is a view inside the AP
   * workspace as of Phase 6 (doc 09 §3.4, ADR-060), and a nav item pointing
   * at a screen that only redirects would be a second route to one place.
   * `exceptions:view` still guards the retry handlers, which is where the
   * control actually is (CLAUDE.md rule 5).
   */
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
 * Platform operator console nav (apps/ops, doc 09 §3.3).
 *
 * A third list rather than a flag on the two above, for the reason the planes
 * are separate apps at all: a platform role holds no tenant-data permission,
 * so an ops item can never appear in a web-app sidebar and vice versa. The
 * filtering is the same `visibleNavItems` — which is the payoff of the
 * registry design, and why `sap_manager` seeing exactly two tabs needs no
 * code, only the rows below.
 */
export const OPS_NAV: readonly NavItem[] = [
  {
    key: "ops-tenants",
    label: "Tenants",
    href: "/tenants",
    icon: "Building2",
    permission: "platform:tenant-crud",
    status: "live",
  },
  {
    key: "ops-sap-config",
    label: "SAP Config",
    href: "/sap/config",
    icon: "PlugZap",
    permission: "platform:sap-config",
    status: "live",
  },
  {
    key: "ops-sap-health",
    label: "SAP Health",
    href: "/sap/health",
    icon: "Activity",
    permission: "platform:sap-health",
    status: "live",
  },
  {
    key: "ops-operators",
    label: "Operators",
    href: "/operators",
    icon: "Users",
    permission: "platform:operators-manage",
    status: "live",
  },
  {
    key: "ops-billing",
    label: "Billing",
    href: "/billing",
    icon: "Wallet",
    permission: "platform:billing",
    status: "live",
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
