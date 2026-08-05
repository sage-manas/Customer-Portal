import { db } from "@cc/db";

import { PlatformError } from "./errors";
import { getTenant, type TenantListItem } from "./tenant-provisioning";

/**
 * Tenant edit and deactivation — the rest of doc 09 §3.3's "tenant CRUD",
 * `super_admin` only. Creation lives in `tenant-provisioning.ts` because it
 * also issues the first login; this is the part that changes a tenant that
 * already exists.
 *
 * There is no delete, and there will not be one (ADR-054). Deactivation is
 * a flag: it refuses every login for the tenant and leaves every row it
 * owns exactly where it is. A tenant's orders, deliveries and payments are
 * the portal's side of documents SAP has already posted — a button that
 * erases them would be a button that puts the two systems permanently out
 * of agreement, and no confirmation dialog makes that recoverable.
 */

export interface UpdateTenantInput {
  tenantId: string;
  name?: string;
  customDomain?: string | null;
  /** Nav item keys to disable; absent key = enabled (moduleToggles' convention). */
  disabledModules?: string[];
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export async function updateTenant(input: UpdateTenantInput): Promise<TenantListItem> {
  const tenant = await db.tenant.findUnique({ where: { id: input.tenantId } });
  if (!tenant) throw new PlatformError("not_found");

  if (input.customDomain) {
    const clash = await db.tenant.findFirst({
      where: { customDomain: input.customDomain.trim(), NOT: { id: input.tenantId } },
    });
    // Same 409 as a taken slug: a custom domain is how a request resolves
    // to a tenant, so two tenants claiming one is not a cosmetic conflict.
    if (clash) throw new PlatformError("tenant_slug_taken");
  }

  await db.tenant.update({
    where: { id: input.tenantId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.customDomain !== undefined
        ? { customDomain: input.customDomain?.trim() || null }
        : {}),
      ...(input.disabledModules !== undefined
        ? { moduleToggles: Object.fromEntries(input.disabledModules.map((key) => [key, false])) }
        : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
      ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor || null } : {}),
    },
  });

  const refreshed = await getTenant(input.tenantId);
  if (!refreshed) throw new PlatformError("not_found");
  return refreshed;
}

export interface SetTenantActiveResult {
  tenantId: string;
  isActive: boolean;
  deactivatedAt: Date | null;
}

/**
 * Soft-deactivates or reactivates a tenant.
 *
 * The consequences the console's confirmation dialog has to name are
 * exactly these, and they are worth listing where the code that causes
 * them lives: every user of the tenant is refused at login
 * (`@cc/service-identity`'s `login` checks `tenant.isActive`), so the
 * portal, the back office and any in-flight session are all closed at the
 * next token refresh; nothing is deleted; scheduled work keeps running,
 * because an outbox event that stops being relayed is a SAP document that
 * silently never gets its portal-side effect. Reactivation restores access
 * with nothing to restore.
 */
export async function setTenantActive(
  tenantId: string,
  isActive: boolean,
): Promise<SetTenantActiveResult> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new PlatformError("not_found");

  const updated = await db.tenant.update({
    where: { id: tenantId },
    data: { isActive, deactivatedAt: isActive ? null : new Date() },
  });

  return {
    tenantId: updated.id,
    isActive: updated.isActive,
    deactivatedAt: updated.deactivatedAt,
  };
}
