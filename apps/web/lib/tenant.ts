import { findTenantByHost, findTenantBySlug, type TenantSummary } from "@cc/service-identity";

import { env } from "./env";
import { getRequestHost } from "./session";

/**
 * Resolves the tenant for the current request from the host
 * (`<slug>.<ROOT_DOMAIN>` or a custom domain), falling back to
 * `DEFAULT_TENANT_SLUG` for local development on bare `localhost`.
 *
 * This is only the *candidate* tenant — for an authenticated request the
 * JWT `tenantId` claim is authoritative, and the middleware rejects a
 * request whose host and claim disagree.
 */
export async function resolveRequestTenant(): Promise<TenantSummary | null> {
  const host = await getRequestHost();
  const byHost = await findTenantByHost(host, env.ROOT_DOMAIN);
  if (byHost) return byHost;
  if (env.DEFAULT_TENANT_SLUG) return findTenantBySlug(env.DEFAULT_TENANT_SLUG);
  return null;
}
