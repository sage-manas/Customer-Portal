/**
 * Roles, permissions and session claims (docs/02-TRD-ARCHITECTURE.md §3,
 * docs/05-UI-UX-DESIGN.md §4.3).
 *
 * This is a registry, like status.ts and sap-mapping/: the permission a
 * route/action requires is declared once here, and both the API guard and
 * the nav visibility read from it. Nothing hardcodes a role check —
 * "is this user a tenant_admin?" is always expressed as "does this user
 * have permission X?", so adding a role never means hunting down `if`s.
 */

/** Three planes -> three role families (docs/02 §3). */
export const ROLES = [
  "platform_operator",
  "tenant_admin",
  "tenant_sales",
  "tenant_credit",
  "tenant_support",
  "buyer_admin",
  "buyer_user",
  "buyer_view_only",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // Customer-plane reads
  "dashboard:view",
  "catalogue:view",
  "inquiry:view",
  "quotation:view",
  "order:view",
  "delivery:view",
  "invoice:view",
  "payment:view",
  "support:view",
  "account:view",
  "report:view",
  // Customer-plane writes
  /** Add/edit/remove cart lines. Separate from `order:create` because the
   * cart is a staging area — a buyer may build one and hand it to a
   * colleague who holds the ordering permission (docs/05 §7.2 split CTA). */
  "cart:manage",
  "inquiry:create",
  "quotation:accept",
  "order:create",
  "order:cancel",
  "delivery:confirm-receipt",
  "payment:pay",
  "support:create",
  /** Ask for a bigger credit limit (docs/03 Screen 9.1). Not on `buyer_user`:
   * the ask commits the account to a commercial conversation and quotes its
   * own justification, which is a buyer_admin's call rather than an
   * everyday transaction like raising an order. */
  "credit:request",
  "account:manage-users",
  // Tenant back-office
  "admin:view",
  "onboarding:review",
  "onboarding:approve",
  "quotation:issue",
  "credit:release",
  /** Decide a customer's credit-limit request. Separate from `credit:release`
   * — releasing a blocked order applies the limit that exists, while this one
   * is about changing it, and a tenant may reasonably grant the first to
   * somebody it would not grant the second. */
  "credit:decide-limit",
  "support:resolve",
  "tenant:settings",
  /** The reconciliation & exception tray (docs/07 B4). Restricted to
   * `tenant_admin` rather than shared with `tenant_credit`/`tenant_support`
   * the way `payment:view`/`support:resolve` are: it exposes cross-account
   * SAP-posting state and internal outbox diagnostics, not a single desk's
   * queue (ADR-044). */
  "exceptions:view",
  // Platform plane
  "platform:operate",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BUYER_VIEW_ONLY: Permission[] = [
  "dashboard:view",
  "catalogue:view",
  "inquiry:view",
  "quotation:view",
  "order:view",
  "delivery:view",
  "invoice:view",
  "payment:view",
  "support:view",
  "account:view",
  "report:view",
];

/** View-only plus the everyday transactional actions a buyer performs. */
const BUYER_USER: Permission[] = [
  ...BUYER_VIEW_ONLY,
  "cart:manage",
  "inquiry:create",
  "quotation:accept",
  "order:create",
  "order:cancel",
  "delivery:confirm-receipt",
  "payment:pay",
  "support:create",
];

/** Back-office roles all need the shell; each adds its own queue. */
const TENANT_BASE: Permission[] = ["admin:view", "dashboard:view", "order:view", "invoice:view"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  buyer_view_only: BUYER_VIEW_ONLY,
  buyer_user: BUYER_USER,
  buyer_admin: [...BUYER_USER, "credit:request", "account:manage-users"],

  tenant_sales: [
    ...TENANT_BASE,
    "catalogue:view",
    "inquiry:view",
    "quotation:view",
    "quotation:issue",
    "onboarding:review",
    "delivery:view",
    "report:view",
  ],
  tenant_credit: [
    ...TENANT_BASE,
    "onboarding:review",
    "credit:release",
    "credit:decide-limit",
    "report:view",
  ],
  tenant_support: [...TENANT_BASE, "support:view", "support:resolve", "delivery:view"],
  tenant_admin: [
    ...TENANT_BASE,
    "catalogue:view",
    "inquiry:view",
    "quotation:view",
    "quotation:issue",
    "delivery:view",
    "payment:view",
    "support:view",
    "support:resolve",
    "report:view",
    "account:view",
    "account:manage-users",
    "onboarding:review",
    "onboarding:approve",
    "credit:release",
    "credit:decide-limit",
    "tenant:settings",
    "exceptions:view",
  ],

  // The operator console (apps/ops) is a separate plane: a platform
  // operator is deliberately NOT granted tenant/customer data permissions.
  platform_operator: ["platform:operate"],
};

/**
 * Claims carried by the access JWT (docs/02 §3: "tenant_id, customer_id
 * (KUNNR), roles as claims"). `kunnr` is the *active* sold-to account —
 * one user may act for several, hence `availableKunnrs` for the account
 * switcher (docs/05 §4.2).
 */
export interface SessionClaims {
  /** JWT `sub` — portal user id. */
  userId: string;
  tenantId: string;
  tenantSlug: string;
  email: string;
  roles: Role[];
  kunnr?: string;
  availableKunnrs: string[];
}

/**
 * The inverse lookup: every role that grants a permission.
 *
 * Exists so a *fan-out* can be filtered in SQL rather than in memory —
 * "which users may be told about this?" becomes `roles hasSome [...]` on the
 * users table (A7). Loading every user and asking `hasPermission` per row
 * would give the same answer and a worse failure mode: the filter would live
 * in a loop somebody can forget, and the rows would be in memory first.
 */
export function rolesWithPermission(permission: Permission): Role[] {
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

/**
 * The single authority on "may this session do X". Called by the API guard
 * (enforcement) and by the nav registry (visibility) — never re-implemented
 * per screen, per docs/05 §4.3 ("the API enforces").
 */
export function hasPermission(
  session: Pick<SessionClaims, "roles"> | null | undefined,
  permission: Permission,
): boolean {
  if (!session) return false;
  return permissionsForRoles(session.roles).has(permission);
}

export function hasAnyPermission(
  session: Pick<SessionClaims, "roles"> | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => hasPermission(session, p));
}

/** True for roles that belong to the tenant back-office plane (/admin/*). */
export function isBackOfficeRole(role: Role): boolean {
  return role.startsWith("tenant_");
}

export function isBuyerRole(role: Role): boolean {
  return role.startsWith("buyer_");
}
