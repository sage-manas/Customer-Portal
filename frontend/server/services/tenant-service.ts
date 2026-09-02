import "server-only";

import { serverEnv } from "../env";
import * as repo from "../repositories/identity-repository";

/**
 * Which tenant a request belongs to, resolved from its host (docs/02 §2).
 *
 * `<slug>.<ROOT_DOMAIN>` or a registered custom domain. The host is the
 * boundary rather than a header or a query parameter because it is the one
 * part of the request a caller cannot change without also changing where the
 * request went.
 */

export interface HostResolution {
  slug: string | null;
  customDomain: string | null;
}

export function resolveTenantFromHost(host: string | null, rootDomain: string): HostResolution {
  if (!host) return { slug: null, customDomain: null };
  const bare = host.split(":")[0].toLowerCase();
  if (bare === rootDomain || bare === "localhost") return { slug: null, customDomain: null };
  if (bare.endsWith(`.${rootDomain}`)) {
    return { slug: bare.slice(0, -(rootDomain.length + 1)), customDomain: null };
  }
  return { slug: null, customDomain: bare };
}

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  moduleToggles: Record<string, boolean>;
  isActive: boolean;
};

function toSummary(tenant: {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  moduleToggles: unknown;
  isActive: boolean;
}): TenantSummary {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    customDomain: tenant.customDomain,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
    moduleToggles: (tenant.moduleToggles as Record<string, boolean>) ?? {},
    isActive: tenant.isActive,
  };
}

/**
 * Resolves a host to its tenant.
 *
 * When the host names no tenant — a bare `localhost:3000` in development, or a
 * single-tenant deployment on its own domain — it falls back, in order, to
 * `DEFAULT_TENANT_SLUG` and then to the sole tenant if there is exactly one.
 *
 * It never guesses among several. Picking one would be a cross-tenant data
 * leak dressed up as a convenience: a login would be looked up inside, and a
 * session minted for, whichever tenant happened to sort first.
 */
export async function resolveTenantByHost(host: string | null): Promise<TenantSummary | null> {
  const { slug, customDomain } = resolveTenantFromHost(host, serverEnv.ROOT_DOMAIN);

  if (customDomain) {
    const byDomain = await repo.findTenantByCustomDomain(customDomain);
    return byDomain ? toSummary(byDomain) : null;
  }

  if (slug) {
    const bySlug = await repo.findTenantBySlug(slug);
    return bySlug ? toSummary(bySlug) : null;
  }

  if (serverEnv.DEFAULT_TENANT_SLUG) {
    const configured = await repo.findTenantBySlug(serverEnv.DEFAULT_TENANT_SLUG);
    return configured ? toSummary(configured) : null;
  }

  const sole = await repo.findSoleTenant();
  return sole ? toSummary(sole) : null;
}

export async function getTenantById(id: string): Promise<TenantSummary | null> {
  const tenant = await repo.findTenantById(id);
  return tenant ? toSummary(tenant) : null;
}

/**
 * A token's tenant must match the host it was sent to. Without this a session
 * minted on one tenant's subdomain would be honoured on another's.
 */
export function hostMatchesSession(
  resolution: HostResolution,
  session: { tenantSlug: string },
  tenant: TenantSummary | null,
): boolean {
  if (!resolution.slug && !resolution.customDomain) return true;
  if (!tenant) return false;
  return tenant.slug === session.tenantSlug;
}
