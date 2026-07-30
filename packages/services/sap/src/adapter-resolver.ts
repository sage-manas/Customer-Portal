import { createSapAdapter, type SapAdapter } from "@cc/adapter-sap";
import { db, getTenantCredential, runWithTenant } from "@cc/db";

/**
 * Resolves a tenant's `SapAdapter` from its stored connection config.
 *
 * This exists so the app layer never imports `@cc/adapter-sap` — the
 * dependency rule is `apps -> ui, services, domain, config`, and
 * `services -> adapters` (CLAUDE.md rule 1). Route handlers ask this
 * service for "the adapter for tenant X"; which driver that is, and where
 * its credentials come from, is not their business.
 *
 * Connection secrets come from the per-tenant credential vault
 * (`@cc/db`, docs/DECISIONS.md ADR-042), decrypted once here and passed
 * to the adapter factory as plain fields — `@cc/adapter-sap` cannot reach
 * `@cc/db` itself (`adapters -> domain, config`, never `db`), so this
 * resolver is the only place envelope decryption and adapter construction
 * meet. A tenant with no stored credential still resolves: the ecc/s4
 * drivers are Phase-7 skeletons that fail loudly on first real call
 * (ADR-006) regardless of what `credentials` holds.
 */
export async function getSapAdapterForTenant(tenantId: string): Promise<SapAdapter> {
  // `tenants` is a platform-plane table, not a tenant-scoped model, so this
  // read is intentionally outside runWithTenant.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  // TenantCredential *is* tenant-scoped (tenant-middleware.ts), so — like
  // every other service that touches a tenant-owned model — this resolver
  // binds its own context rather than assuming a caller already did.
  const credentials =
    tenant.sapDriver === "mock"
      ? null
      : await runWithTenant(tenantId, () => getTenantCredential(tenantId, "sap"));

  return createSapAdapter({
    tenantId: tenant.id,
    driver: tenant.sapDriver,
    ecc:
      tenant.sapDriver === "ecc"
        ? {
            endpoint: process.env.SAP_ECC_ENDPOINT ?? "",
            client: process.env.SAP_ECC_CLIENT ?? "100",
            credentials: (credentials ?? {}) as Record<string, string>,
          }
        : undefined,
    s4:
      tenant.sapDriver === "s4"
        ? {
            baseUrl: process.env.SAP_S4_BASE_URL ?? "",
            credentials: (credentials ?? {}) as Record<string, string>,
          }
        : undefined,
  });
}
