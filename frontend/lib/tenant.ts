import { DEMO_TENANT, findTenantByHost, findTenantBySlug, type TenantSummary } from "@cc/service-identity";

import { getRequestHost } from "./session";

/**
 * Migrated from client/apps/web/lib/tenant.ts.
 *
 * The original resolves the tenant from the host (`<slug>.<ROOT_DOMAIN>` or
 * a custom domain) against the Tenant table. Demo mode is single-tenant, so
 * this always resolves to `DEMO_TENANT` — but the call site and the shape
 * are unchanged, so the layouts, the login screen's branding and the nav's
 * module toggles all still read a tenant rather than a constant.
 *
 * TODO(BACKEND):
 * Restore host-based tenant resolution against the Tenant table, and the
 * middleware check that a token's `tenantId` claim matches the host.
 */
export async function resolveRequestTenant(): Promise<TenantSummary | null> {
  const host = await getRequestHost();
  return (await findTenantByHost(host, "localhost")) ?? (await findTenantBySlug(DEMO_TENANT.slug));
}
