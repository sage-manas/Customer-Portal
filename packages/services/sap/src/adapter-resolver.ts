import { createSapAdapter, resetSapAdapter, type SapAdapter } from "@cc/adapter-sap";
import { db, getTenantCredential, runWithTenant } from "@cc/db";
import { instrumentAdapter } from "@cc/observability";

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

  // The stored bag's keys are `SAP_CONNECTION_FIELDS` in @cc/domain — the
  // same registry the ops console's configuration form renders from
  // (doc 09 §3.3). Reading `params.endpoint` here and writing `endpoint`
  // there is only safe because neither side spells the key itself.
  const params = (credentials ?? {}) as Record<string, string>;

  // Env vars remain the fallback for a tenant configured before the console
  // existed, and for local development where nothing is in the vault. A
  // stored value always wins: a per-tenant setting that an environment
  // variable could override would make the console's screen a suggestion.
  const adapter = createSapAdapter({
    tenantId: tenant.id,
    driver: tenant.sapDriver,
    ecc:
      tenant.sapDriver === "ecc"
        ? {
            endpoint: params.endpoint ?? process.env.SAP_ECC_ENDPOINT ?? "",
            client: params.client ?? process.env.SAP_ECC_CLIENT ?? "100",
            credentials: params,
          }
        : undefined,
    s4:
      tenant.sapDriver === "s4"
        ? {
            baseUrl: params.baseUrl ?? process.env.SAP_S4_BASE_URL ?? "",
            credentials: params,
          }
        : undefined,
  });

  // A span + a structured log per method call, for free, at the one place
  // every caller of this resolver already passes through (docs/07 B3,
  // `@cc/observability`'s `instrumentAdapter`).
  return instrumentAdapter("sap", adapter, { tenantId: tenant.id, driver: tenant.sapDriver });
}

/**
 * Drops a tenant's cached adapter.
 *
 * The factory caches one instance per tenant because a driver owns
 * connection state — a pool, and the per-tenant circuit breaker of docs/02
 * §4.3 — so a saved configuration change that nobody invalidated would keep
 * talking to the previous system until the process restarted. The operator
 * console calls this after every SAP configuration write, and before a
 * connection test, so the test probes what is stored rather than what a
 * resolver happened to build earlier.
 *
 * Async despite doing nothing asynchronous: this is the app-facing surface
 * of adapter resolution, its sibling is async, and a caller that has to
 * remember which of the two to await is a caller that will get it wrong.
 */
export async function resetSapAdapterForTenant(tenantId: string): Promise<void> {
  resetSapAdapter(tenantId);
}
