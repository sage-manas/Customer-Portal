/**
 * Tenant resolution from the request host (docs/02-TRD-ARCHITECTURE.md §2:
 * "tenant resolution from subdomain/custom domain + JWT claim").
 *
 * This resolves the *candidate* tenant only. The authoritative tenant for
 * data access is the JWT `tenantId` claim, and the two must agree — see
 * `assertHostMatchesSession`. Trusting the host alone would let anyone
 * switch tenants by editing a URL.
 */

export interface HostResolution {
  /** Subdomain slug, when the host is `<slug>.<rootDomain>`. */
  slug?: string;
  /** Full host, when it is a tenant's custom domain (CNAME per docs/02 §2). */
  customDomain?: string;
}

/** Hosts that never identify a tenant (local dev, apex, preview envs). */
const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "ops", "localhost"]);

export function resolveTenantFromHost(
  host: string | null | undefined,
  rootDomain: string,
): HostResolution {
  if (!host) return {};

  // Strip the port and normalise; `Host` headers are attacker-controlled.
  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname) return {};

  const root = rootDomain.trim().toLowerCase();
  if (hostname === root || hostname === `www.${root}`) return {};

  if (hostname.endsWith(`.${root}`)) {
    const slug = hostname.slice(0, -(root.length + 1));
    // Only a single label is a tenant slug: `a.b.root` is not `a`.
    if (!slug || slug.includes(".") || RESERVED_SUBDOMAINS.has(slug)) return {};
    return { slug };
  }

  // Local development: `acme.localhost` still resolves a tenant.
  if (hostname.endsWith(".localhost")) {
    const slug = hostname.slice(0, -".localhost".length);
    if (!slug || slug.includes(".") || RESERVED_SUBDOMAINS.has(slug)) return {};
    return { slug };
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") return {};

  return { customDomain: hostname };
}

/**
 * True when the session's tenant matches the tenant the host resolves to.
 * A false result must be treated as 404, not 403 — never confirm that
 * another tenant's portal exists (docs/05 §8).
 */
export function hostMatchesSession(
  resolution: HostResolution,
  session: { tenantSlug: string } | null | undefined,
  tenantCustomDomain?: string | null,
): boolean {
  if (!session) return false;
  // No tenant in the host (apex/localhost) => the JWT is the sole authority.
  if (!resolution.slug && !resolution.customDomain) return true;
  if (resolution.slug) return resolution.slug === session.tenantSlug;
  return Boolean(tenantCustomDomain) && resolution.customDomain === tenantCustomDomain;
}
