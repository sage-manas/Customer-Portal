import { createSapAdapter, type SapAdapter } from "@cc/adapter-sap";
import { db } from "@cc/db";

/**
 * Resolves a tenant's `SapAdapter` from its stored connection config.
 *
 * This exists so the app layer never imports `@cc/adapter-sap` — the
 * dependency rule is `apps -> ui, services, domain, config`, and
 * `services -> adapters` (CLAUDE.md rule 1). Route handlers ask this
 * service for "the adapter for tenant X"; which driver that is, and where
 * its credentials come from, is not their business.
 *
 * Connection credentials are referenced, never inlined: `credentialsRef`
 * points at the per-tenant encrypted secret (KMS envelope pattern, docs/02
 * §2/§9), which the ecc/s4 drivers resolve when they are built in Phase 7.
 */
export async function getSapAdapterForTenant(tenantId: string): Promise<SapAdapter> {
  // `tenants` is a platform-plane table, not a tenant-scoped model, so this
  // read is intentionally outside runWithTenant.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  return createSapAdapter({
    tenantId: tenant.id,
    driver: tenant.sapDriver,
    ecc:
      tenant.sapDriver === "ecc"
        ? {
            endpoint: process.env.SAP_ECC_ENDPOINT ?? "",
            client: process.env.SAP_ECC_CLIENT ?? "100",
            credentialsRef: `kms://${tenant.slug}/sap`,
          }
        : undefined,
    s4:
      tenant.sapDriver === "s4"
        ? {
            baseUrl: process.env.SAP_S4_BASE_URL ?? "",
            credentialsRef: `kms://${tenant.slug}/sap`,
          }
        : undefined,
  });
}
