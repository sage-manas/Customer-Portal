import { createGstnAdapter, type GstnAdapter } from "@cc/adapter-gstn";
import { createObjectStorage, type ObjectStorage } from "@cc/adapter-storage";
import { db } from "@cc/db";

/**
 * Adapter resolution for the onboarding module.
 *
 * GSTN is resolved per tenant from its stored driver setting, exactly like
 * the SAP adapter is (`@cc/service-sap`) — a tenant with real GSTN
 * credentials is a config change, not a code change. Object storage is
 * platform-wide (see `@cc/adapter-storage` README), so it comes from env.
 *
 * The *SAP* adapter is deliberately not resolved here: it belongs to
 * `@cc/service-sap`, and a service may not import another service
 * (CLAUDE.md rule 1). Callers pass it in, the same way the dashboard page
 * passes it to `getDashboardSummary` — see docs/DECISIONS.md ADR-011.
 */

export async function getGstnAdapterForTenant(tenantId: string): Promise<GstnAdapter> {
  // `tenants` is a platform-plane table, not tenant-scoped: read unbound.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  return createGstnAdapter({
    tenantId: tenant.id,
    driver: tenant.gstnDriver,
    api:
      tenant.gstnDriver === "api"
        ? {
            baseUrl: process.env.GSTN_API_BASE_URL ?? "",
            credentialsRef: `kms://${tenant.slug}/gstn`,
          }
        : undefined,
  });
}

export function getOnboardingStorage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER === "local" ? "local" : "memory";
  return createObjectStorage({
    driver,
    root: process.env.STORAGE_ROOT ?? ".storage",
  });
}

/**
 * Storage key for an uploaded document. Tenant-prefixed by construction:
 * one tenant's objects can neither collide with nor be guessed from
 * another's, even though the store itself is shared.
 */
export function documentStorageKey(
  tenantId: string,
  applicationId: string,
  kind: string,
  fileName: string,
): string {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${tenantId}/onboarding/${applicationId}/${kind}${extension.toLowerCase()}`;
}
