import { resolveTenantByHost, type TenantSummary } from "@/server/services/tenant-service";

import { getRequestHost } from "./session";

/**
 * The tenant this request belongs to, resolved from its host (docs/02 §2).
 *
 * Phase 1 always answered with a single hardcoded tenant. It now reads the
 * Tenant table: `<slug>.<ROOT_DOMAIN>` or a registered custom domain, so
 * `acme.localhost:3000` and `globex.localhost:3000` are different portals with
 * different branding, different module toggles and — via the session's
 * `tenantId` — different data.
 *
 * Returns null when the host names no tenant and none can be assumed. Callers
 * already handle that: the login screen falls back to the product name, and the
 * layouts treat it as "not a tenant portal".
 */
export type { TenantSummary };

export async function resolveRequestTenant(): Promise<TenantSummary | null> {
  return resolveTenantByHost(await getRequestHost());
}
