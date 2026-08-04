import type { Permission, Role } from "./auth";
import { ROLES, isPlatformRole, rolesWithPermission } from "./auth";

/**
 * The API route registry (doc 09 §4.4, doc 10 Phase 3).
 *
 * `navigation.ts` already declares the permission behind every *tab*; this
 * declares the permission behind every *handler*, which is the thing
 * CLAUDE.md rule 5 says is the actual control ("hiding a nav item is
 * presentation; `requirePermission` in the route handler is the control").
 * Until now that declaration lived only in the handler's own first line,
 * which meant the answer to "who may call this?" could only be obtained by
 * reading 60-odd files, and "is every route declared at all?" could only be
 * answered by a regex looking for the *shape* of a guard call rather than
 * for the right one.
 *
 * With the routes as data, three things become mechanical:
 *
 *  - the route x role matrix test regenerates itself. For each row, the
 *    roles `rolesWithPermission(permission)` returns must pass the real
 *    guard and every other role must be refused — no fixture list of roles
 *    to keep in step with the registry, so a permission moved between
 *    groups in `auth.ts` re-derives the whole expectation.
 *  - a new handler that is not declared here fails CI, because the sweep in
 *    each app compares this table against the filesystem in both directions.
 *  - plane separation is checkable rather than conventional: a `web` row
 *    whose permission is reachable by a platform role is a test failure,
 *    not a code review note.
 *
 * This registry is *not* the enforcement point and must never become one.
 * It is a declaration the enforcement is checked against; the guard call
 * stays in the handler, where a reader of that file can see it.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Which app serves the route. The two planes have separate sessions and
 * share no role (doc 09 §1), so the plane is part of a route's identity. */
export type ApiPlane = "web" | "ops";

/**
 * What the handler must do before it does anything else.
 *
 * `public` carries a reason rather than being a bare flag: every public
 * route in this codebase is public for a specific, arguable reason (an
 * applicant has no session; a gateway is not a person; a load balancer is
 * not a tenant), and a reason that has to be written down is one somebody
 * can disagree with in review. A `public` row with an empty reason fails
 * the registry's own test.
 */
export type RouteGuard =
  | { kind: "permission"; permission: Permission }
  | { kind: "session" }
  | { kind: "public"; reason: string };

/**
 * The data boundary the handler is responsible for beneath the permission.
 *
 * A permission answers "may this role call this at all"; it says nothing
 * about *whose* rows come back, and the two failures are independent — a
 * `customer` holding `order:view` legitimately may still not read another
 * customer's order. The values name where the answer comes from:
 *
 *  - `kunnr`  — scoped to the session's sold-to account; a mismatch is 404,
 *               never 403 (CLAUDE.md rule 5). The app sweep asserts these
 *               handlers take the account from the session rather than from
 *               the request.
 *  - `tenant` — back-office reads, bounded by `runWithTenant` alone.
 *  - `user`   — the caller's own rows (their bell, their session).
 *  - `none`   — nothing tenant-owned is read (health, login, webhooks).
 */
export type RouteScope = "kunnr" | "tenant" | "user" | "none";

export interface ApiRoute {
  plane: ApiPlane;
  /** Path as Next.js routes it, dynamic segments included: `/api/orders/[vbeln]`. */
  path: string;
  method: HttpMethod;
  guard: RouteGuard;
  scope: RouteScope;
  /** Why this row is worth a comment — omitted where the permission says it all. */
  note?: string;
}

// ---- apps/web -------------------------------------------------------------

const WEB_ROUTES: readonly ApiRoute[] = [
  // Auth & infrastructure
  {
    plane: "web",
    path: "/api/auth/login",
    method: "POST",
    guard: { kind: "public", reason: "Issues the session; there is nothing to authorize yet." },
    scope: "none",
  },
  {
    plane: "web",
    path: "/api/auth/logout",
    method: "POST",
    guard: {
      kind: "public",
      reason:
        "Signing out must work with an expired token, or a stale cookie can never be cleared. Deletes cookies only.",
    },
    scope: "none",
  },
  {
    plane: "web",
    path: "/api/auth/switch-account",
    method: "POST",
    guard: { kind: "session" },
    scope: "user",
    note: "No permission: switching between accounts the user already holds is not a capability, and the service re-checks the link in the database.",
  },
  {
    plane: "web",
    path: "/api/health",
    method: "GET",
    guard: {
      kind: "public",
      reason: "The caller is an orchestrator polling the process, not a tenant (docs/07 B3).",
    },
    scope: "none",
  },
  {
    plane: "web",
    path: "/api/webhooks/payment-gateway",
    method: "POST",
    guard: {
      kind: "public",
      reason:
        "The caller is a payment gateway, not a person. Authenticated by HMAC over the raw body before parsing (docs/02 §6).",
    },
    scope: "none",
  },

  // Onboarding — applicant plane. No session exists yet (ADR-009): the
  // tenant comes from the host and the application from an unguessable
  // draft token, which is why these are public and `/api/admin/onboarding/*`
  // emphatically is not.
  ...(
    [
      { path: "/api/onboarding", method: "POST" },
      { path: "/api/onboarding/[id]", method: "GET" },
      { path: "/api/onboarding/[id]/step/[step]", method: "PUT" },
      { path: "/api/onboarding/[id]/submit", method: "POST" },
      { path: "/api/onboarding/[id]/gstin-verify", method: "POST" },
      { path: "/api/onboarding/[id]/documents/[kind]", method: "POST" },
      { path: "/api/onboarding/[id]/documents/[kind]", method: "DELETE" },
    ] as const
  ).map((route): ApiRoute => ({
    plane: "web",
    path: route.path,
    method: route.method,
    guard: {
      kind: "public",
      reason:
        "An applicant has no portal user until approval; the draft token is the credential (ADR-009).",
    },
    scope: "none",
  })),

  // Catalogue & cart
  {
    plane: "web",
    path: "/api/catalogue/materials/[material]/availability",
    method: "GET",
    guard: { kind: "permission", permission: "catalogue:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/cart",
    method: "GET",
    guard: { kind: "permission", permission: "catalogue:view" },
    scope: "kunnr",
    note: "Reading the cart is a catalogue read — repriced per read, and a role that may browse may see what it staged.",
  },
  {
    plane: "web",
    path: "/api/cart",
    method: "DELETE",
    guard: { kind: "permission", permission: "cart:manage" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/cart/lines",
    method: "POST",
    guard: { kind: "permission", permission: "cart:manage" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/cart/lines/[lineId]",
    method: "PATCH",
    guard: { kind: "permission", permission: "cart:manage" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/cart/lines/[lineId]",
    method: "DELETE",
    guard: { kind: "permission", permission: "cart:manage" },
    scope: "kunnr",
  },

  // Inquiries & quotations
  {
    plane: "web",
    path: "/api/inquiries",
    method: "GET",
    guard: { kind: "permission", permission: "inquiry:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/inquiries",
    method: "POST",
    guard: { kind: "permission", permission: "inquiry:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/inquiries/drafts",
    method: "GET",
    guard: { kind: "permission", permission: "inquiry:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/inquiries/drafts",
    method: "POST",
    guard: { kind: "permission", permission: "inquiry:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/inquiries/drafts/[id]",
    method: "PUT",
    guard: { kind: "permission", permission: "inquiry:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/inquiries/drafts/[id]",
    method: "DELETE",
    guard: { kind: "permission", permission: "inquiry:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/quotations/[vbeln]/accept",
    method: "POST",
    guard: { kind: "permission", permission: "quotation:accept" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/quotations/[vbeln]/revision",
    method: "POST",
    guard: { kind: "permission", permission: "inquiry:create" },
    scope: "kunnr",
    note: "Asking for a revision creates a new inquiry, so it is the inquiry permission — not `quotation:accept`, which commits money.",
  },

  // Orders
  {
    plane: "web",
    path: "/api/orders",
    method: "GET",
    guard: { kind: "permission", permission: "order:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders",
    method: "POST",
    guard: { kind: "permission", permission: "order:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/[vbeln]",
    method: "GET",
    guard: { kind: "permission", permission: "order:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/[vbeln]/cancel",
    method: "POST",
    guard: { kind: "permission", permission: "order:cancel" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/availability",
    method: "POST",
    guard: { kind: "permission", permission: "order:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/drafts",
    method: "GET",
    guard: { kind: "permission", permission: "order:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/drafts",
    method: "POST",
    guard: { kind: "permission", permission: "order:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/drafts/[id]",
    method: "PUT",
    guard: { kind: "permission", permission: "order:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/orders/drafts/[id]",
    method: "DELETE",
    guard: { kind: "permission", permission: "order:create" },
    scope: "kunnr",
  },

  // Deliveries & POD
  {
    plane: "web",
    path: "/api/deliveries",
    method: "GET",
    guard: { kind: "permission", permission: "delivery:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/deliveries/[vbeln]",
    method: "GET",
    guard: { kind: "permission", permission: "delivery:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/deliveries/[vbeln]/pod",
    method: "GET",
    guard: { kind: "permission", permission: "delivery:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/deliveries/[vbeln]/pod",
    method: "POST",
    guard: { kind: "permission", permission: "delivery:confirm-receipt" },
    scope: "kunnr",
    note: "Confirming receipt and reporting a discrepancy are the same call (ADR-026), so they are one permission.",
  },
  {
    plane: "web",
    path: "/api/deliveries/[vbeln]/pod/signed",
    method: "POST",
    guard: { kind: "permission", permission: "delivery:confirm-receipt" },
    scope: "kunnr",
  },

  // Invoices
  {
    plane: "web",
    path: "/api/invoices",
    method: "GET",
    guard: { kind: "permission", permission: "invoice:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/invoices/[vbeln]",
    method: "GET",
    guard: { kind: "permission", permission: "invoice:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/invoices/[vbeln]/pdf",
    method: "GET",
    guard: { kind: "permission", permission: "invoice:view" },
    scope: "kunnr",
  },

  // Payments
  {
    plane: "web",
    path: "/api/payments",
    method: "GET",
    guard: { kind: "permission", permission: "payment:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/payments",
    method: "POST",
    guard: { kind: "permission", permission: "payment:pay" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/payments/[id]",
    method: "GET",
    guard: { kind: "permission", permission: "payment:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/payments/[id]/complete-mock",
    method: "POST",
    guard: { kind: "permission", permission: "payment:pay" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/payments/open-items",
    method: "GET",
    guard: { kind: "permission", permission: "payment:view" },
    scope: "kunnr",
  },

  // Support
  {
    plane: "web",
    path: "/api/support",
    method: "GET",
    guard: { kind: "permission", permission: "support:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/support",
    method: "POST",
    guard: { kind: "permission", permission: "support:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/support/[id]",
    method: "GET",
    guard: { kind: "permission", permission: "support:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/support/[id]/comments",
    method: "POST",
    guard: { kind: "permission", permission: "support:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/support/[id]/rating",
    method: "POST",
    guard: { kind: "permission", permission: "support:create" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/support/[id]/status",
    method: "POST",
    guard: { kind: "permission", permission: "support:create" },
    scope: "kunnr",
    note: "A customer may close and reopen, never resolve; which moves are legal is the transition table's job, not this permission's.",
  },
  {
    plane: "web",
    path: "/api/support/attachments",
    method: "POST",
    guard: { kind: "permission", permission: "support:create" },
    scope: "user",
    note: "Uploads to a scratch key before a ticket exists, so there is no KUNNR yet to scope to.",
  },

  // Account, credit & loyalty
  {
    plane: "web",
    path: "/api/account/credit",
    method: "GET",
    guard: { kind: "permission", permission: "account:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/account/loyalty",
    method: "GET",
    guard: { kind: "permission", permission: "account:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/account/credit/requests",
    method: "GET",
    guard: { kind: "permission", permission: "account:view" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/account/credit/requests",
    method: "POST",
    guard: { kind: "permission", permission: "credit:request" },
    scope: "kunnr",
  },
  {
    plane: "web",
    path: "/api/account/credit/requests/[id]/withdraw",
    method: "POST",
    guard: { kind: "permission", permission: "credit:request" },
    scope: "kunnr",
  },

  // Notifications
  {
    plane: "web",
    path: "/api/notifications",
    method: "GET",
    guard: { kind: "permission", permission: "dashboard:view" },
    scope: "user",
    note: "The bell is per user, not per account (ADR-039) — eligibility was decided when the row was written.",
  },
  {
    plane: "web",
    path: "/api/notifications/read",
    method: "POST",
    guard: { kind: "permission", permission: "dashboard:view" },
    scope: "user",
  },

  // Back office
  {
    plane: "web",
    path: "/api/admin/onboarding/[id]/documents/[kind]",
    method: "GET",
    guard: { kind: "permission", permission: "onboarding:review" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/onboarding/[id]/request-info",
    method: "POST",
    guard: { kind: "permission", permission: "onboarding:review" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/onboarding/[id]/approve",
    method: "POST",
    guard: { kind: "permission", permission: "onboarding:approve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/onboarding/[id]/reject",
    method: "POST",
    guard: { kind: "permission", permission: "onboarding:approve" },
    scope: "tenant",
    note: "Rejecting is a decision on the application, so it needs the approver's permission, not the reviewer's.",
  },
  {
    plane: "web",
    path: "/api/admin/quotations",
    method: "GET",
    guard: { kind: "permission", permission: "quotation:issue" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/quotations",
    method: "POST",
    guard: { kind: "permission", permission: "quotation:issue" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/tickets",
    method: "GET",
    guard: { kind: "permission", permission: "support:resolve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/tickets/[id]",
    method: "GET",
    guard: { kind: "permission", permission: "support:resolve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/tickets/[id]",
    method: "PATCH",
    guard: { kind: "permission", permission: "support:resolve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/tickets/[id]/comments",
    method: "POST",
    guard: { kind: "permission", permission: "support:resolve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/tickets/[id]/status",
    method: "POST",
    guard: { kind: "permission", permission: "support:resolve" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/credit/requests",
    method: "GET",
    guard: { kind: "permission", permission: "credit:decide-limit" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/credit/requests/[id]/decision",
    method: "POST",
    guard: { kind: "permission", permission: "credit:decide-limit" },
    scope: "tenant",
    note: "Deciding a limit request is `client_admin` only; `ar_manager` holds `credit:release`, which applies the limit that exists rather than changing it.",
  },
  {
    plane: "web",
    path: "/api/admin/exceptions/outbox/[id]/retry",
    method: "POST",
    guard: { kind: "permission", permission: "exceptions:view" },
    scope: "tenant",
  },
  {
    plane: "web",
    path: "/api/admin/exceptions/payments/[id]/retry",
    method: "POST",
    guard: { kind: "permission", permission: "exceptions:view" },
    scope: "tenant",
    note: "In the AP group (doc 09 §3.4): gateway-side money movement is AP's desk, so `ap_manager` reaches the tray without being an admin.",
  },
];

// ---- apps/ops -------------------------------------------------------------

const OPS_ROUTES: readonly ApiRoute[] = [
  {
    plane: "ops",
    path: "/api/auth/login",
    method: "POST",
    guard: {
      kind: "public",
      reason: "Issues the operator session; there is nothing to authorize yet.",
    },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/auth/logout",
    method: "POST",
    guard: {
      kind: "public",
      reason: "Must work with an expired token, exactly as apps/web's does. Deletes cookies only.",
    },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/tenants",
    method: "GET",
    guard: { kind: "permission", permission: "platform:tenant-crud" },
    scope: "none",
    note: "The tenant list is CRUD's index, so it is super-admin only; the per-tenant picker the SAP screens need is their own route (Phase 4), not this one.",
  },
  {
    plane: "ops",
    path: "/api/tenants",
    method: "POST",
    guard: { kind: "permission", permission: "platform:tenant-crud" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]",
    method: "GET",
    guard: { kind: "permission", permission: "platform:tenant-crud" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]",
    method: "PATCH",
    guard: { kind: "permission", permission: "platform:tenant-crud" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]/status",
    method: "POST",
    guard: { kind: "permission", permission: "platform:tenant-crud" },
    scope: "none",
    note: "Soft deactivate/reactivate (ADR-054). There is no DELETE, here or anywhere — a tenant's O2C history is the portal's side of documents SAP has posted.",
  },

  // SAP configuration — the screens both platform roles share, and the
  // reason `sap_manager` is a role rather than a restriction. These are
  // `platform:sap-config`, deliberately *not* `platform:tenant-crud`: a SAP
  // manager configures every tenant's connection and creates none of them.
  {
    plane: "ops",
    path: "/api/sap/tenants",
    method: "GET",
    guard: { kind: "permission", permission: "platform:sap-config" },
    scope: "none",
    note: "The per-tenant picker the SAP screens need — id/name/slug/driver only, which is why it is its own route rather than `/api/tenants`, the CRUD index.",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]/sap-config",
    method: "GET",
    guard: { kind: "permission", permission: "platform:sap-config" },
    scope: "none",
    note: "Returns non-secret connection values and whether each secret is set — never a stored secret's value (ADR-053).",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]/sap-config",
    method: "PUT",
    guard: { kind: "permission", permission: "platform:sap-config" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/tenants/[id]/sap-config/test",
    method: "POST",
    guard: { kind: "permission", permission: "platform:sap-config" },
    scope: "none",
    note: "Resolves the adapter through @cc/service-sap and hands it to @cc/service-platform — a service may not import another service (ADR-011).",
  },
  {
    plane: "ops",
    path: "/api/sap/health",
    method: "GET",
    guard: { kind: "permission", permission: "platform:sap-health" },
    scope: "none",
  },

  // Operator management & billing — `super_admin` alone (doc 09 §2).
  {
    plane: "ops",
    path: "/api/operators",
    method: "GET",
    guard: { kind: "permission", permission: "platform:operators-manage" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/operators",
    method: "POST",
    guard: { kind: "permission", permission: "platform:operators-manage" },
    scope: "none",
  },
  {
    plane: "ops",
    path: "/api/operators/[id]/status",
    method: "POST",
    guard: { kind: "permission", permission: "platform:operators-manage" },
    scope: "none",
  },
];

export const API_ROUTES: readonly ApiRoute[] = [...WEB_ROUTES, ...OPS_ROUTES];

// ---- Lookups --------------------------------------------------------------

/** Stable identity of a row — one handler is one (plane, method, path). */
export function apiRouteKey(route: Pick<ApiRoute, "plane" | "method" | "path">): string {
  return `${route.plane} ${route.method} ${route.path}`;
}

export function apiRoutesForPlane(plane: ApiPlane): ApiRoute[] {
  return API_ROUTES.filter((route) => route.plane === plane);
}

export function findApiRoute(
  plane: ApiPlane,
  method: HttpMethod,
  path: string,
): ApiRoute | undefined {
  return API_ROUTES.find(
    (route) => route.plane === plane && route.method === method && route.path === path,
  );
}

/** The roles a plane's sessions can carry at all — platform roles for the
 * operator console, everything else for the portal (doc 09 §1: a platform
 * role never appears in a web-app JWT). */
export function rolesOnPlane(plane: ApiPlane): Role[] {
  return ROLES.filter((role) => (plane === "ops" ? isPlatformRole(role) : !isPlatformRole(role)));
}

/**
 * Every role the route admits. Derived, never listed: a permission moved
 * between the AP/AR/ops groups in `auth.ts` changes this answer — and with
 * it the matrix test's expectation — without anybody editing a test.
 *
 * This describes what the *guard* admits, which is why a `session` route
 * lists every role rather than the plane's: `requireSession` asks for a
 * session and nothing more, and what keeps a platform role out of a portal
 * token is the issuer (`@cc/service-identity` reads a `User` row; the
 * console's realm has its own signature entirely, ADR-045), not the guard.
 * Saying "the plane's roles" here would credit the guard with a check it
 * does not perform. `public` lists everybody for the same honesty: nobody
 * is turned away, including callers with no session at all.
 */
export function rolesAllowedOn(route: ApiRoute): Role[] {
  switch (route.guard.kind) {
    case "permission":
      return rolesWithPermission(route.guard.permission).filter((role) =>
        rolesOnPlane(route.plane).includes(role),
      );
    case "session":
    case "public":
      return [...ROLES];
  }
}
