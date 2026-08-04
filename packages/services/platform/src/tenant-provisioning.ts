import { randomBytes } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import type { GstnDriver, PaymentGatewayDriver, SapDriver } from "@cc/db";

import { PlatformError } from "./errors";
import { hashPassword } from "./password";

/**
 * Tenant provisioning — the operator console's write path (docs/07 B5).
 *
 * Creates the `Tenant` row (platform-plane, same table `findTenant` in
 * `@cc/service-identity` already reads unscoped) and the tenant's first
 * `client_admin` login in one call. This is not `provisionPortalAccess`
 * (`@cc/service-identity`) reused: that function issues a *buyer* account
 * against a SAP KUNNR the applicant already has, and a service may not
 * import another service anyway (rule 1) — a fresh tenant has no KUNNR yet
 * and needs a back-office login, not a customer one.
 */

export interface CreateTenantInput {
  slug: string;
  name: string;
  customDomain?: string;
  sapDriver?: SapDriver;
  gstnDriver?: GstnDriver;
  paymentGateway?: PaymentGatewayDriver;
  /** Module keys to opt *out* (absent = enabled, matching `moduleToggles`'s convention). */
  disabledModules?: string[];
  adminEmail: string;
}

export interface CreateTenantResult {
  tenantId: string;
  slug: string;
  adminUserId: string;
  adminEmail: string;
  /** Shown once to the operator; only its scrypt hash is stored. */
  temporaryPassword: string;
}

function temporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

export async function createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
  const slug = input.slug.trim().toLowerCase();
  const adminEmail = input.adminEmail.trim().toLowerCase();

  const existing = await db.tenant.findUnique({ where: { slug } });
  if (existing) throw new PlatformError("tenant_slug_taken");

  const moduleToggles = Object.fromEntries(
    (input.disabledModules ?? []).map((key) => [key, false]),
  );

  const tenant = await db.tenant.create({
    data: {
      slug,
      name: input.name.trim(),
      customDomain: input.customDomain?.trim() || null,
      sapDriver: input.sapDriver ?? "mock",
      gstnDriver: input.gstnDriver ?? "mock",
      paymentGateway: input.paymentGateway ?? "mock",
      moduleToggles,
    },
  });

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  const adminUser = await runWithTenant(tenant.id, () =>
    db.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        roles: ["client_admin"],
        passwordHash,
        mustChangePassword: true,
      },
    }),
  );

  return {
    tenantId: tenant.id,
    slug: tenant.slug,
    adminUserId: adminUser.id,
    adminEmail,
    temporaryPassword: password,
  };
}

export interface TenantListItem {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  sapDriver: SapDriver;
  /** Soft-deactivation state (ADR-054): `false` refuses every login. */
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
}

function toListItem(tenant: {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  sapDriver: SapDriver;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
}): TenantListItem {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    customDomain: tenant.customDomain,
    sapDriver: tenant.sapDriver,
    isActive: tenant.isActive,
    deactivatedAt: tenant.deactivatedAt,
    createdAt: tenant.createdAt,
  };
}

/**
 * Platform-plane read, like `findTenant` — no `runWithTenant` needed: this
 * *is* the tenant registry.
 *
 * Deactivated tenants are listed, not filtered out: this is the console's
 * CRUD index, and a tenant an operator can no longer see is a tenant they
 * cannot reactivate. The row carries `isActive` so the screen can say so.
 */
export async function listTenants(): Promise<TenantListItem[]> {
  const tenants = await db.tenant.findMany({ orderBy: { createdAt: "desc" } });
  return tenants.map(toListItem);
}

export async function getTenant(tenantId: string): Promise<TenantListItem | null> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  return tenant ? toListItem(tenant) : null;
}
