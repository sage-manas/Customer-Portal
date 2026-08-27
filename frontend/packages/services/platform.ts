/**
 * Frontend-only stand-in for `@cc/service-platform` — the operator console's
 * service layer (tenants, SAP config, operators, health, usage, billing).
 *
 * The console is the platform plane: in /client it is a separate Next app
 * (apps/ops) reading the platform tables directly. Everything it reads is
 * seeded here so the console renders and its screens behave; the writes
 * mutate the in-memory store and say so in the UI.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-platform: the `Tenant`, `Operator` and
 * `TenantSapConfig` tables, the encrypted credential vault (ADR-042), the
 * outbox depth query and @cc/adapter-billing.
 */

import type { Role, SapDriverKind } from "@cc/domain";

import { DemoAuthError, DemoServiceError, demoStore, nextSequence } from "./_demo";

export class PlatformError extends DemoServiceError {
  constructor(message: string, code = "platform_error", status = 400) {
    super(message, { code, status });
    this.name = "PlatformError";
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError;
}

export type PlatformErrorCode = string;

export const OPERATOR_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OPERATOR_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
export const OPERATOR_CLAIM_VERSION = 1;

/**
 * The console's session claims. `roles` is the same `Role` union the portal
 * uses, so `hasPermission` and `visibleNavItems` work here unchanged — which
 * is what makes `sap_manager` see exactly two tabs with no code to say so.
 */
export interface OperatorClaims {
  operatorId: string;
  email: string;
  roles: Role[];
}

export interface OperatorTokenPair {
  accessToken: string;
  refreshToken: string;
}

export type OperatorTokenType = "access" | "refresh";

export async function issueOperatorTokens(claims: OperatorClaims): Promise<OperatorTokenPair> {
  return { accessToken: JSON.stringify(claims), refreshToken: JSON.stringify(claims) };
}

export async function verifyOperatorToken(token: string, _secret: string): Promise<OperatorClaims> {
  // TODO(BACKEND): a real operator token is an HS256 JWT (jose, edge-safe).
  try {
    return JSON.parse(token) as OperatorClaims;
  } catch {
    throw new DemoAuthError("Session is not valid.", 401, "invalid_token");
  }
}

export function requireOperatorSession(claims: OperatorClaims | null): OperatorClaims {
  if (!claims) throw new DemoAuthError("Not authenticated", 401, "unauthenticated");
  return claims;
}

export async function requireOperatorPermission(
  claims: OperatorClaims | null,
  permission: string,
): Promise<OperatorClaims> {
  const { hasPermission } = await import("@cc/domain");
  const active = requireOperatorSession(claims);
  if (!hasPermission(active, permission as never)) {
    throw new DemoAuthError("You don't have permission to do that.", 403, "forbidden");
  }
  return active;
}

export function hashPassword(): never {
  throw new DemoAuthError("Not available in demo mode.", 503, "demo_read_only");
}

export function verifyPassword(): boolean {
  return false;
}

export interface OperatorLoginResult {
  claims: OperatorClaims;
  tokens: OperatorTokenPair;
}

export async function operatorLogin(): Promise<OperatorLoginResult> {
  throw new DemoAuthError(
    "Sign in from the portal login screen and choose a platform demo account.",
    503,
    "demo_login_only",
  );
}

export async function setOperatorPassword(): Promise<void> {
  throw new PlatformError("Passwords can't be set in demo mode.", "demo_read_only", 503);
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  sapDriver: SapDriverKind;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
}

function tenants(): TenantListItem[] {
  const store = demoStore();
  if (store.tenants.length === 0) {
    store.tenants = [
      {
        id: "tenant-acme",
        slug: "acme",
        name: "Acme Industrial",
        customDomain: null,
        sapDriver: "mock",
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date("2026-01-05T00:00:00.000Z"),
      },
      {
        id: "tenant-northwind",
        slug: "northwind",
        name: "Northwind Components",
        customDomain: "portal.northwind.example",
        sapDriver: "ecc",
        isActive: true,
        deactivatedAt: null,
        createdAt: new Date("2026-03-18T00:00:00.000Z"),
      },
      {
        id: "tenant-lapsed",
        slug: "lapsed",
        name: "Lapsed Traders",
        customDomain: null,
        sapDriver: "mock",
        isActive: false,
        deactivatedAt: new Date("2026-06-30T00:00:00.000Z"),
        createdAt: new Date("2025-11-02T00:00:00.000Z"),
      },
    ] satisfies TenantListItem[];
  }
  return store.tenants as TenantListItem[];
}

export async function listTenants(): Promise<TenantListItem[]> {
  return [...tenants()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTenant(id: string): Promise<TenantListItem> {
  const tenant = tenants().find((row) => row.id === id);
  if (!tenant) throw new PlatformError("We couldn't find that tenant.", "not_found", 404);
  return tenant;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  customDomain?: string;
  sapDriver?: SapDriverKind;
  gstnDriver?: string;
  paymentGateway?: string;
  disabledModules?: string[];
  adminEmail: string;
}

export interface CreateTenantResult {
  tenantId: string;
  slug: string;
  adminUserId: string;
  adminEmail: string;
  temporaryPassword: string;
}

export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  if (tenants().some((row) => row.slug === input.slug)) {
    throw new PlatformError("That slug is already taken.", "slug_taken", 409);
  }

  const tenant: TenantListItem = {
    id: `tenant-${input.slug}`,
    slug: input.slug,
    name: input.name,
    customDomain: input.customDomain ?? null,
    sapDriver: input.sapDriver ?? "mock",
    isActive: true,
    deactivatedAt: null,
    createdAt: new Date(),
  };
  tenants().push(tenant);

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    adminUserId: `user-${tenant.id}-admin`,
    adminEmail: input.adminEmail,
    // TODO(BACKEND): the real provisioning mints a one-time password and
    // stores only its scrypt hash.
    temporaryPassword: "(demo mode — no password is issued)",
  };
}

export interface UpdateTenantInput {
  name?: string;
  customDomain?: string | null;
}

export async function updateTenant(id: string, input: UpdateTenantInput): Promise<TenantListItem> {
  const tenant = await getTenant(id);
  if (input.name !== undefined) tenant.name = input.name;
  if (input.customDomain !== undefined) tenant.customDomain = input.customDomain;
  return tenant;
}

export interface SetTenantActiveResult {
  tenant: TenantListItem;
}

export async function setTenantActive(
  id: string,
  isActive: boolean,
): Promise<SetTenantActiveResult> {
  const tenant = await getTenant(id);
  tenant.isActive = isActive;
  tenant.deactivatedAt = isActive ? null : new Date();
  // ADR-054: deactivation refuses every login; it never deletes data.
  return { tenant };
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export interface OperatorListItem {
  id: string;
  email: string;
  roles: Role[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function operators(): OperatorListItem[] {
  const store = demoStore();
  if (store.operators.length === 0) {
    store.operators = [
      {
        id: "demo-super-admin",
        email: "ops@customerconnect.example",
        roles: ["super_admin"],
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: new Date("2026-07-26T07:45:00.000Z"),
        createdAt: new Date("2025-10-01T00:00:00.000Z"),
      },
      {
        id: "demo-sap-manager",
        email: "sap@customerconnect.example",
        roles: ["sap_manager"],
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: new Date("2026-07-24T14:10:00.000Z"),
        createdAt: new Date("2026-02-11T00:00:00.000Z"),
      },
    ] satisfies OperatorListItem[];
  }
  return store.operators as OperatorListItem[];
}

export async function listOperators(): Promise<OperatorListItem[]> {
  return [...operators()].sort((a, b) => a.email.localeCompare(b.email));
}

export interface CreateOperatorInput {
  email: string;
  roles: Role[];
}

export interface CreateOperatorResult {
  operator: OperatorListItem;
  temporaryPassword: string;
}

export async function createOperator(input: CreateOperatorInput): Promise<CreateOperatorResult> {
  if (operators().some((row) => row.email === input.email)) {
    throw new PlatformError("An operator with that email already exists.", "email_taken", 409);
  }

  const operator: OperatorListItem = {
    id: `operator-${nextSequence("operator")}`,
    email: input.email,
    roles: input.roles,
    isActive: true,
    mustChangePassword: true,
    lastLoginAt: null,
    createdAt: new Date(),
  };
  operators().push(operator);

  return { operator, temporaryPassword: "(demo mode — no password is issued)" };
}

export async function setOperatorActive(id: string, isActive: boolean): Promise<OperatorListItem> {
  const operator = operators().find((row) => row.id === id);
  if (!operator) throw new PlatformError("We couldn't find that operator.", "not_found", 404);
  operator.isActive = isActive;
  return operator;
}

// ---------------------------------------------------------------------------
// SAP configuration
// ---------------------------------------------------------------------------

export interface SapConnectionFieldState {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  value: string | null;
  isSet: boolean;
}

export interface TenantSapConfig {
  tenantId: string;
  tenantName: string;
  driver: SapDriverKind;
  fields: SapConnectionFieldState[];
  missing: string[];
}

/** The connection parameters each driver declares — a registry, as in /client. */
const DRIVER_FIELDS: Record<SapDriverKind, SapConnectionFieldState[]> = {
  mock: [],
  ecc: [
    { key: "ashost", label: "Application server host", secret: false, required: true, value: null, isSet: false, placeholder: "sapecc.example.internal" },
    { key: "sysnr", label: "System number", secret: false, required: true, value: null, isSet: false, placeholder: "00" },
    { key: "client", label: "Client", secret: false, required: true, value: null, isSet: false, placeholder: "800" },
    { key: "user", label: "RFC user", secret: false, required: true, value: null, isSet: false
    },
    { key: "password", label: "RFC password", secret: true, required: true, value: null, isSet: false, help: "Stored envelope-encrypted; never returned." },
  ],
  s4: [
    { key: "baseUrl", label: "OData base URL", secret: false, required: true, value: null, isSet: false, placeholder: "https://s4.example.internal/sap/opu/odata" },
    { key: "client", label: "Client", secret: false, required: true, value: null, isSet: false },
    { key: "user", label: "Service user", secret: false, required: true, value: null, isSet: false },
    { key: "password", label: "Service password", secret: true, required: true, value: null, isSet: false, help: "Stored envelope-encrypted; never returned." },
  ],
};

export async function getTenantSapConfig(tenantId: string): Promise<TenantSapConfig> {
  const tenant = await getTenant(tenantId);
  const fields = DRIVER_FIELDS[tenant.sapDriver].map((field) => ({ ...field }));

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    driver: tenant.sapDriver,
    fields,
    missing: fields.filter((field) => field.required && !field.isSet).map((field) => field.key),
  };
}

export interface UpdateSapConfigInput {
  tenantId: string;
  driver: SapDriverKind;
  params: Record<string, string>;
  clearSecrets?: string[];
  operatorId: string;
  operatorEmail: string;
}

export interface UpdateSapConfigResult {
  driverChanged: boolean;
  changedFields: string[];
  missing: string[];
}

export async function updateTenantSapConfig(
  input: UpdateSapConfigInput,
): Promise<UpdateSapConfigResult> {
  const tenant = await getTenant(input.tenantId);
  const driverChanged = tenant.sapDriver !== input.driver;
  tenant.sapDriver = input.driver;

  // TODO(BACKEND):
  // The real service writes each parameter into the envelope-encrypted
  // credential vault (ADR-042) and records an audit entry. Demo mode keeps
  // the driver choice and discards the parameters — nothing here should
  // ever hold a real credential.
  const config = await getTenantSapConfig(input.tenantId);
  return {
    driverChanged,
    changedFields: Object.keys(input.params),
    missing: config.missing,
  };
}

export interface SapConnectionTestResult {
  reachable: boolean;
  driver: string;
  circuit: "closed" | "open" | "half-open" | "unknown";
  checkedAt: string;
  error?: string;
}

export interface SapHealthProbe {
  health(): Promise<{
    reachable: boolean;
    driver: string;
    circuit: "closed" | "open" | "half-open";
    checkedAt: string;
  }>;
}

export async function testSapConnection(
  tenantId: string,
  probe?: SapHealthProbe,
): Promise<SapConnectionTestResult> {
  const tenant = await getTenant(tenantId);
  if (!probe) {
    return {
      reachable: tenant.sapDriver === "mock",
      driver: tenant.sapDriver,
      circuit: tenant.sapDriver === "mock" ? "closed" : "unknown",
      checkedAt: new Date().toISOString(),
      error:
        tenant.sapDriver === "mock"
          ? undefined
          : "The ecc/s4 drivers aren't implemented yet — Track C.",
    };
  }

  try {
    const result = await probe.health();
    return { ...result };
  } catch (error) {
    return {
      reachable: false,
      driver: tenant.sapDriver,
      circuit: "unknown",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Probe failed",
    };
  }
}

export interface SapConfigAuditEntry {
  id: string;
  tenantId: string;
  operatorEmail: string;
  /** What happened: a driver switch, a credential change, or a test. */
  action: "driver.changed" | "connection.updated" | "connection.cleared" | "connection.tested";
  fromDriver: SapDriverKind | null;
  toDriver: SapDriverKind | null;
  changedFields: string[];
  /** Outcome of a `connection_tested` entry; null for the others. */
  result: string | null;
  createdAt: Date;
}

export interface RecordSapConfigAuditInput {
  tenantId: string;
  operatorId: string;
  operatorEmail: string;
  changedFields: string[];
}

export async function listSapConfigAudit(
  _tenantId: string,
  _limit = 25,
): Promise<SapConfigAuditEntry[]> {
  // TODO(BACKEND): the audit trail is a table; demo mode keeps none.
  return [];
}

export async function recordSapConfigAudit(
  _input: RecordSapConfigAuditInput,
): Promise<void> {
  /* No audit store in demo mode. */
}

// ---------------------------------------------------------------------------
// Health, usage, billing
// ---------------------------------------------------------------------------

export type SapConnectivityStatus = "mock_ok" | "not_certified";

export interface TenantHealth {
  tenantId: string;
  sapDriver: SapDriverKind;
  gstnDriver: string;
  paymentGateway: string;
  sapConnectivity: SapConnectivityStatus;
  outboxPending: number;
  outboxFailed: number;
}

export async function getTenantHealth(tenantId: string): Promise<TenantHealth> {
  const tenant = await getTenant(tenantId);
  return {
    tenantId: tenant.id,
    sapDriver: tenant.sapDriver,
    gstnDriver: "mock",
    paymentGateway: "mock",
    // Honest about "chosen" vs "working": ecc/s4 are not certified yet.
    sapConnectivity: tenant.sapDriver === "mock" ? "mock_ok" : "not_certified",
    outboxPending: tenant.isActive ? 2 : 0,
    outboxFailed: tenant.slug === "northwind" ? 1 : 0,
  };
}

export interface TenantUsage {
  tenantId: string;
  userCount: number;
  salesOrderCount: number;
  supportTicketCount: number;
  paymentCount: number;
}

export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  const tenant = await getTenant(tenantId);
  // TODO(BACKEND): counted per tenant from the portal tables.
  const scale = tenant.slug === "acme" ? 1 : tenant.slug === "northwind" ? 2 : 0;
  return {
    tenantId,
    userCount: 3 * scale,
    salesOrderCount: 14 * scale,
    supportTicketCount: 5 * scale,
    paymentCount: 9 * scale,
  };
}

export interface TenantBilling {
  plan: string;
  seatLimit: number;
  source: string;
}

export async function getTenantBilling(tenantId: string): Promise<TenantBilling> {
  const tenant = await getTenant(tenantId);
  // TODO(BACKEND): @cc/adapter-billing's mock driver. Nothing charges anyone.
  return {
    plan: tenant.slug === "northwind" ? "Growth" : "Starter",
    seatLimit: tenant.slug === "northwind" ? 25 : 10,
    source: "mock",
  };
}
