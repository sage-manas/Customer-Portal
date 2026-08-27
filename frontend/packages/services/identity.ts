/**
 * Frontend-only stand-in for `@cc/service-identity`.
 *
 * This is the module Phase 1 changes most, and deliberately: the real one
 * verifies a scrypt password hash against the `User` table and mints a
 * signed HS256 JWT. There is no user table and no secret here, so login is
 * a *demo* login against the fixed accounts in `DEMO_ACCOUNTS` below — one
 * per role that actually exists in the project (packages/domain/auth.ts).
 *
 * What is NOT relaxed: the roles, the permissions each role holds, and the
 * KUNNR each demo account is scoped to are the real ones. Every route guard,
 * nav filter and 403 in the migrated app runs against them unchanged, so
 * role-based access still behaves exactly as it does in /client.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-identity:
 *   - POST /api/auth/login against the User table (scrypt + rehash)
 *   - HS256 access/refresh tokens signed with AUTH_SECRET
 *   - tenant resolution from the Tenant table rather than the constant below
 */

import { ROLE_PERMISSIONS, hasPermission, type Permission, type Role, type SessionClaims } from "@cc/domain";

import { DemoAuthError } from "./_demo";

export const AuthError = DemoAuthError;
export type AuthErrorCode = string;

export function isAuthError(error: unknown): error is DemoAuthError {
  return error instanceof DemoAuthError;
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const CLAIM_VERSION = 1;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type TokenType = "access" | "refresh";

// ---------------------------------------------------------------------------
// The demo tenant
// ---------------------------------------------------------------------------

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  logoUrl: string | null;
  moduleToggles: Record<string, boolean>;
  isActive: boolean;
}

/** The seeded landscape's tenant (see sap-mock/mock/seed.ts). */
export const DEMO_TENANT: TenantSummary = {
  id: "tenant-acme",
  slug: "acme",
  name: "Acme Industrial",
  customDomain: null,
  logoUrl: null,
  // Absent means enabled — tenants opt modules *out*, not in.
  moduleToggles: {},
  isActive: true,
};

export async function findTenant(_id: string): Promise<TenantSummary | null> {
  return DEMO_TENANT;
}

export async function findTenantBySlug(_slug: string): Promise<TenantSummary | null> {
  return DEMO_TENANT;
}

export async function findTenantByHost(
  _host: string | null,
  _rootDomain: string,
): Promise<TenantSummary | null> {
  return DEMO_TENANT;
}

export interface HostResolution {
  slug: string | null;
  customDomain: string | null;
}

export function resolveTenantFromHost(host: string | null, rootDomain: string): HostResolution {
  if (!host) return { slug: null, customDomain: null };
  const bare = host.split(":")[0];
  if (bare === rootDomain || bare === "localhost") return { slug: null, customDomain: null };
  if (bare.endsWith(`.${rootDomain}`)) {
    return { slug: bare.slice(0, -1 * (rootDomain.length + 1)), customDomain: null };
  }
  return { slug: null, customDomain: bare };
}

export function hostMatchesSession(
  _resolution: HostResolution,
  _session: Pick<SessionClaims, "tenantSlug">,
): boolean {
  // Demo mode is single-tenant, so the host can never disagree with the
  // claim. The real check is restored with the tenant table.
  return true;
}

// ---------------------------------------------------------------------------
// Demo accounts — one per role in packages/domain/auth.ts
// ---------------------------------------------------------------------------

export interface DemoAccount {
  id: string;
  email: string;
  /** Shown on the login screen's demo-account picker. */
  label: string;
  description: string;
  roles: Role[];
  kunnr?: string;
  availableKunnrs: string[];
}

/**
 * The six identifiers of the five-tier model (doc 09 §1), each with an
 * account that can actually exercise its plane. The KUNNRs are the seeded
 * customers, so a `customer` login lands on a dashboard with real orders,
 * invoices and a credit position behind it.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    id: "demo-customer",
    email: "buyer@acme-industrial.example",
    label: "Customer",
    description: "The buyer plane: catalogue, orders, invoices, payments, support.",
    roles: ["customer"],
    kunnr: "0010001001",
    // One user may act for several sold-to accounts (docs/05 §4.2), so the
    // account switcher in the top bar has something to switch between.
    availableKunnrs: ["0010001001", "0010001002"],
  },
  {
    id: "demo-client-admin",
    email: "admin@acme-industrial.example",
    label: "Client Admin",
    description: "The tenant back office: everything AP, AR and ops staff can do.",
    roles: ["client_admin"],
    availableKunnrs: [],
  },
  {
    id: "demo-ap-manager",
    email: "ap@acme-industrial.example",
    label: "AP Manager",
    description: "Accounts Payable: refunds, rebate settlement, the reconciliation tray.",
    roles: ["ap_manager"],
    availableKunnrs: [],
  },
  {
    id: "demo-ar-manager",
    email: "ar@acme-industrial.example",
    label: "AR Manager",
    description: "Accounts Receivable: the invoice register and credit-block releases.",
    roles: ["ar_manager"],
    availableKunnrs: [],
  },
  {
    id: "demo-super-admin",
    email: "ops@customerconnect.example",
    label: "Super Admin",
    description: "The platform console: tenants, SAP config, operators, billing.",
    roles: ["super_admin"],
    availableKunnrs: [],
  },
  {
    id: "demo-sap-manager",
    email: "sap@customerconnect.example",
    label: "SAP Manager",
    description: "The platform console, narrowed: SAP Config and SAP Health only.",
    roles: ["sap_manager"],
    availableKunnrs: [],
  },
] as const;

export function findDemoAccount(email: string): DemoAccount | undefined {
  const needle = email.trim().toLowerCase();
  return (
    DEMO_ACCOUNTS.find((account) => account.email.toLowerCase() === needle) ??
    // Anything else signs in as the customer, so a demo never dead-ends on
    // the login screen for want of knowing the seeded addresses.
    DEMO_ACCOUNTS.find((account) => account.id === "demo-customer")
  );
}

export function claimsFor(account: DemoAccount): SessionClaims {
  return {
    userId: account.id,
    tenantId: DEMO_TENANT.id,
    tenantSlug: DEMO_TENANT.slug,
    email: account.email,
    roles: account.roles,
    kunnr: account.kunnr,
    availableKunnrs: account.availableKunnrs,
  };
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  session: SessionClaims;
  tokens: TokenPair;
}

export async function login(_tenantId: string, input: LoginInput): Promise<LoginResult> {
  // TODO(BACKEND):
  // Replace with the real login: look the user up in the tenant, verify the
  // scrypt hash, rehash if the parameters have moved on, and mint tokens.
  // Expected endpoint: POST /api/auth/login
  const account = findDemoAccount(input.email);
  if (!account) {
    throw new DemoAuthError("That email and password don't match an account.", 401, "bad_credentials");
  }

  const session = claimsFor(account);
  return {
    session,
    tokens: { accessToken: JSON.stringify(session), refreshToken: JSON.stringify(session) },
  };
}

export async function switchAccount(
  session: SessionClaims,
  kunnr: string,
): Promise<SessionClaims> {
  if (!session.availableKunnrs.includes(kunnr)) {
    throw new DemoAuthError("That account isn't linked to your login.", 403, "forbidden");
  }
  return { ...session, kunnr };
}

export async function setPassword(): Promise<void> {
  throw new DemoAuthError("Passwords can't be changed in demo mode.", 503, "demo_read_only");
}

// ---------------------------------------------------------------------------
// Tokens — demo mode carries the claims in the cookie, unsigned
// ---------------------------------------------------------------------------

export async function issueTokens(session: SessionClaims): Promise<TokenPair> {
  return { accessToken: JSON.stringify(session), refreshToken: JSON.stringify(session) };
}

/**
 * TODO(BACKEND):
 * A real access token is an HS256 JWT verified against AUTH_SECRET. The demo
 * cookie is *not* a credential — it carries the chosen demo account, and the
 * data behind it is the same seeded landscape for everybody. Nothing in this
 * phase may be treated as an authentication boundary.
 */
export async function verifyToken(token: string, _secret: string): Promise<SessionClaims> {
  try {
    return JSON.parse(token) as SessionClaims;
  } catch {
    throw new DemoAuthError("Session is not valid.", 401, "invalid_token");
  }
}

// ---------------------------------------------------------------------------
// Guards — the real ones, unchanged
// ---------------------------------------------------------------------------

export function requireSession(session: SessionClaims | null): SessionClaims {
  if (!session) throw new DemoAuthError("Not authenticated", 401, "unauthenticated");
  return session;
}

export async function requirePermission(
  session: SessionClaims | null,
  permission: Permission,
): Promise<SessionClaims> {
  const active = requireSession(session);
  if (!hasPermission(active, permission)) {
    throw new DemoAuthError("You don't have permission to do that.", 403, "forbidden");
  }
  return active;
}

export function requireCustomerAccount(session: SessionClaims): string {
  if (!session.kunnr) {
    throw new DemoAuthError("No customer account is linked to this login.", 403, "no_account");
  }
  return session.kunnr;
}

export function resolveActiveKunnr(session: SessionClaims, requested?: string): string | undefined {
  if (!requested) return session.kunnr;
  return session.availableKunnrs.includes(requested) ? requested : session.kunnr;
}

export function hashPassword(): never {
  throw new DemoAuthError("Not available in demo mode.", 503, "demo_read_only");
}

export function verifyPassword(): boolean {
  return false;
}

export function needsRehash(): boolean {
  return false;
}

export interface ProvisionPortalAccessInput {
  tenantId: string;
  kunnr: string;
  email: string;
}

export interface ProvisionPortalAccessResult {
  userId: string;
  email: string;
  temporaryPassword: string;
}

export async function provisionPortalAccess(
  input: ProvisionPortalAccessInput,
): Promise<ProvisionPortalAccessResult> {
  // TODO(BACKEND):
  // Creates the portal user and emails a one-time password. Demo mode
  // returns a placeholder so the approval screen can show what *would* be
  // sent, and says so.
  return {
    userId: `user-${input.kunnr}`,
    email: input.email,
    temporaryPassword: "(demo mode — no password is issued)",
  };
}

export { ROLE_PERMISSIONS };
