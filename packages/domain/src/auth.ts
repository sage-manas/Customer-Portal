/**
 * Roles, permissions and session claims (docs/09-RBAC-RESTRUCTURE-PLAN.md §1–2,
 * superseding the eight-role model of docs/02-TRD-ARCHITECTURE.md §3).
 *
 * This is a registry, like status.ts and sap-mapping/: the permission a
 * route/action requires is declared once here, and both the API guard and
 * the nav visibility read from it. Nothing hardcodes a role check —
 * "is this user a client_admin?" is always expressed as "does this user
 * have permission X?", so adding a role never means hunting down `if`s.
 * A lint rule (`no-restricted-syntax` in packages/config/eslint/base.js)
 * makes that a mechanical guarantee outside this file.
 */

/**
 * Five tiers, six identifiers, three planes (doc 09 §1).
 *
 * AP and AR share a tier, which is why the product language says five roles
 * and the code says six. The plane a role belongs to is derivable from this
 * table alone — see the helpers at the bottom.
 */
export const ROLES = [
  // Platform plane (apps/ops)
  "super_admin",
  "sap_manager",
  // Tenant plane (apps/web /admin/*)
  "client_admin",
  "ap_manager",
  "ar_manager",
  // Customer plane (apps/web portal)
  "customer",
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
  /** Add/edit/remove cart lines. Kept separate from `order:create` even though
   * one `customer` role now holds both: the cart is a staging area, and the
   * split is what lets a tenant re-introduce a narrower buyer role later
   * without re-cutting the permission table (doc 09 §2 "exact leaf
   * permissions reuse today's registry; only groupings change"). */
  "cart:manage",
  "inquiry:create",
  "quotation:accept",
  "order:create",
  "order:cancel",
  "delivery:confirm-receipt",
  "payment:pay",
  "support:create",
  /** Ask for a bigger credit limit (docs/03 Screen 9.1). */
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
  /** The reconciliation & exception tray (docs/07 B4). Sits in the AP group
   * (doc 09 §3.4) rather than being admin-only as it was under the old
   * model: it is gateway-side money movement, which is AP's desk. */
  "exceptions:view",
  /** Register a customer from the back office (doc 09 §3.4) — the tenant-side
   * mirror of public self-registration. */
  "customer:register",
  "customer:edit",
  /** Blocks login and new orders; never deletes O2C history (doc 09 §3.4,
   * built in Phase 5 — the tenant-level equivalent is ADR-054). */
  "customer:deactivate",
  /** The AP workspace: outgoing money (doc 09 §1 tier 4). */
  "finance:ap",
  /** The AR workspace: incoming money (doc 09 §1 tier 4). */
  "finance:ar",
  // Platform plane
  /** The ops shell, the platform-plane mirror of `admin:view`. Both platform
   * roles hold it; it gates the console, never a capability inside it. */
  "platform:operate",
  "platform:tenant-crud",
  "platform:sap-config",
  "platform:sap-health",
  "platform:operators-manage",
  "platform:billing",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ---- Permission groups ----------------------------------------------------
//
// The groups are the unit doc 09 §2 defines the matrix in, and `client_admin`
// is composed from them rather than hand-listed. Hand-listing is how a
// permission granted to `ap_manager` silently fails to reach the tenant admin
// who is supposed to be able to do everything their staff can.

/** Everything the buyer plane can do — the whole `customer` role. */
const CUSTOMER_PLANE: Permission[] = [
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
  "cart:manage",
  "inquiry:create",
  "quotation:accept",
  "order:create",
  "order:cancel",
  "delivery:confirm-receipt",
  "payment:pay",
  "support:create",
  "credit:request",
  "account:manage-users",
];

/** The shell every back-office role needs before it adds its own queue. */
const ADMIN_BASE: Permission[] = ["admin:view", "dashboard:view"];

/** Accounts Payable: outgoing money (doc 09 §3.4). */
const TENANT_AP: Permission[] = [
  ...ADMIN_BASE,
  "finance:ap",
  "invoice:view",
  "payment:view",
  "order:view",
  "exceptions:view",
];

/** Accounts Receivable: incoming money, plus releasing a credit-blocked order. */
const TENANT_AR: Permission[] = [
  ...ADMIN_BASE,
  "finance:ar",
  "invoice:view",
  "payment:view",
  "order:view",
  "delivery:view",
  "report:view",
  "credit:release",
];

/** Everything else the tenant back office does — onboarding, sales desk,
 * support, customers, settings. */
const TENANT_OPS: Permission[] = [
  ...ADMIN_BASE,
  "catalogue:view",
  "inquiry:view",
  "quotation:view",
  "quotation:issue",
  "order:view",
  "delivery:view",
  "invoice:view",
  "payment:view",
  "report:view",
  "account:view",
  "account:manage-users",
  "onboarding:review",
  "onboarding:approve",
  "support:view",
  "support:resolve",
  "credit:release",
  "credit:decide-limit",
  "tenant:settings",
  "customer:register",
  "customer:edit",
  "customer:deactivate",
];

/** The platform capabilities `sap_manager` shares with `super_admin`. */
const PLATFORM_SAP: Permission[] = [
  "platform:operate",
  "platform:sap-config",
  "platform:sap-health",
];

const unique = (permissions: Permission[]): readonly Permission[] => [...new Set(permissions)];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // The operator console (apps/ops) is a separate plane: a platform role is
  // deliberately granted zero tenant/customer data permissions (doc 09 §1).
  super_admin: unique([
    ...PLATFORM_SAP,
    "platform:tenant-crud",
    "platform:operators-manage",
    "platform:billing",
  ]),
  sap_manager: unique(PLATFORM_SAP),

  // Composed, never hand-listed (doc 09 §2): the tenant's admin can do
  // everything their AP, AR and back-office staff can, by construction.
  client_admin: unique([...TENANT_AP, ...TENANT_AR, ...TENANT_OPS]),
  ap_manager: unique(TENANT_AP),
  ar_manager: unique(TENANT_AR),

  customer: unique(CUSTOMER_PLANE),
};

// ---- Legacy roles ---------------------------------------------------------

/** The eight identifiers this model replaces. Kept only as the domain of
 * `LEGACY_ROLE_MAP`; nothing may grant one. */
export const LEGACY_ROLES = [
  "platform_operator",
  "tenant_admin",
  "tenant_sales",
  "tenant_credit",
  "tenant_support",
  "buyer_admin",
  "buyer_user",
  "buyer_view_only",
] as const;

export type LegacyRole = (typeof LEGACY_ROLES)[number];

/**
 * Legacy → new mapping (doc 09 §3.1), exported because the Phase 2 data
 * migration and any lingering data must map identically — a second copy of
 * this table in a migration script is how two answers to "what is a
 * tenant_sales now?" come to exist.
 *
 * `tenant_sales` and `tenant_support` widen: neither has a target of its own
 * in the five-tier model, and `client_admin` is the only role that holds the
 * quotation desk and the ticket workbench. Widening is the safe direction to
 * be *wrong* in only because the migration reports every such user for manual
 * re-assignment (doc 09 §4.2) — silently widening without the report would
 * not be.
 */
export const LEGACY_ROLE_MAP: Record<LegacyRole, Role> = {
  platform_operator: "super_admin",
  tenant_admin: "client_admin",
  tenant_credit: "ar_manager",
  tenant_sales: "client_admin",
  tenant_support: "client_admin",
  buyer_admin: "customer",
  buyer_user: "customer",
  buyer_view_only: "customer",
};

/** Legacy roles whose mapping grants strictly more than they had, and which
 * the migration report must list for a human to narrow (doc 09 §4.2). */
export const LEGACY_ROLES_NEEDING_REVIEW: readonly LegacyRole[] = [
  "tenant_sales",
  "tenant_support",
];

export function isLegacyRole(value: string): value is LegacyRole {
  return (LEGACY_ROLES as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

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

// ---- Planes ---------------------------------------------------------------
//
// Derived from the permission table rather than from the role's spelling.
// The old helpers matched a name prefix (`role.startsWith("tenant_")`), which
// made the plane a property of the identifier's text; these make it a
// property of what the role can actually reach, so a role added to the wrong
// group fails the "exactly one plane" test instead of merely reading oddly.

/** True for roles that operate the platform console (apps/ops). */
export function isPlatformRole(role: Role): boolean {
  return ROLE_PERMISSIONS[role].includes("platform:operate");
}

/** True for roles that belong to the tenant back-office plane (/admin/*). */
export function isBackOfficeRole(role: Role): boolean {
  return ROLE_PERMISSIONS[role].includes("admin:view");
}

/** True for the buyer plane. */
export function isCustomerRole(role: Role): boolean {
  return !isPlatformRole(role) && !isBackOfficeRole(role);
}
