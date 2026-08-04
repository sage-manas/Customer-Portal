import { db, runWithTenant } from "@cc/db";
import type { Role, SessionClaims } from "@cc/domain";

import { AuthError } from "./errors";
import { issueTokens, type TokenPair } from "./jwt";
import { hashPassword, verifyPassword } from "./password";
import { resolveTenantFromHost, type HostResolution } from "./tenant-resolution";

/**
 * Identity service — the first `packages/services` module (docs/DECISIONS.md
 * ADR-005). Framework-free by design: no Next.js imports, so the BFF route
 * handlers stay thin adapters and this logic survives the move behind
 * NestJS/Fastify later (ADR-002).
 */

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  moduleToggles: Record<string, boolean>;
  /** Soft deactivation from the operator console (ADR-054). `login` refuses
   * an inactive tenant; the flag is on the summary so a screen can say why
   * rather than only failing. */
  isActive: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
  /** Resolved from the request host before calling. */
  tenantSlug?: string;
  customDomain?: string;
}

export interface LoginResult {
  session: SessionClaims;
  tokens: TokenPair;
  tenant: TenantSummary;
  /** docs/05 §8 — first-login forced password change. */
  mustChangePassword: boolean;
}

/**
 * A syntactically valid hash of a random string. Verifying against it when
 * no user matches keeps the failed-login path the same cost as the success
 * path, so response timing doesn't enumerate valid addresses.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Y2Fubm90LW1hdGNoLWFueXRoaW5nLWV2ZXItYmVjYXVzZS1yYW5kb20tcGFkZGluZy0wMDAwMDA=";

function toModuleToggles(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

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
    moduleToggles: toModuleToggles(tenant.moduleToggles),
    isActive: tenant.isActive,
  };
}

/** Tenant is a platform-plane table: not tenant-scoped, safe to read unbound. */
export async function findTenant(resolution: HostResolution): Promise<TenantSummary | null> {
  const where = resolution.slug
    ? { slug: resolution.slug }
    : resolution.customDomain
      ? { customDomain: resolution.customDomain }
      : null;
  if (!where) return null;

  const tenant = await db.tenant.findFirst({ where });
  return tenant ? toSummary(tenant) : null;
}

export async function findTenantByHost(
  host: string | null | undefined,
  rootDomain: string,
): Promise<TenantSummary | null> {
  return findTenant(resolveTenantFromHost(host, rootDomain));
}

export async function findTenantBySlug(slug: string): Promise<TenantSummary | null> {
  return findTenant({ slug });
}

/**
 * Credentials login. Every failure mode below the tenant lookup returns the
 * same `invalid_credentials` error: whether the address exists, whether it
 * has a password set, and whether the password was wrong are all the same
 * answer to anyone outside.
 */
export async function login(input: LoginInput, authSecret: string): Promise<LoginResult> {
  const tenant = await findTenant({ slug: input.tenantSlug, customDomain: input.customDomain });
  if (!tenant) throw new AuthError("tenant_not_found");
  // The teeth behind the operator console's deactivate button (ADR-054).
  // Checked before the password is verified, because the answer does not
  // depend on it — and unlike the credential path there is nothing to
  // conceal here: whoever is typing already knows this portal exists.
  if (!tenant.isActive) throw new AuthError("tenant_inactive");

  const email = input.email.trim().toLowerCase();

  const user = await runWithTenant(tenant.id, () =>
    db.user.findFirst({
      where: { email },
      include: { accountLinks: true },
    }),
  );

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) throw new AuthError("invalid_credentials");
  if (!user.isActive) throw new AuthError("account_inactive");

  const availableKunnrs = user.accountLinks.map((link) => link.sapKunnr).sort();
  const session: SessionClaims = {
    userId: user.id,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    email: user.email,
    roles: user.roles as Role[],
    kunnr: availableKunnrs[0],
    availableKunnrs,
  };

  await runWithTenant(tenant.id, () =>
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  );

  return {
    session,
    tokens: await issueTokens(session, authSecret),
    tenant,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Switches the active sold-to account (docs/05 §4.2 account switcher) and
 * re-issues tokens. The requested KUNNR must already be linked to the
 * user — the claim is rebuilt from the DB, never from client input.
 */
export async function switchAccount(
  session: SessionClaims,
  kunnr: string,
  authSecret: string,
): Promise<{ session: SessionClaims; tokens: TokenPair }> {
  const link = await runWithTenant(session.tenantId, () =>
    db.userAccountLink.findFirst({ where: { userId: session.userId, sapKunnr: kunnr } }),
  );
  if (!link) throw new AuthError("forbidden");

  const next: SessionClaims = { ...session, kunnr };
  return { session: next, tokens: await issueTokens(next, authSecret) };
}

/** Sets a new password (first-login change or self-service reset). */
export async function setPassword(session: SessionClaims, newPassword: string): Promise<void> {
  if (newPassword.length < 12) {
    throw new AuthError("invalid_credentials");
  }
  const passwordHash = await hashPassword(newPassword);
  await runWithTenant(session.tenantId, () =>
    db.user.update({
      where: { id: session.userId },
      data: { passwordHash, mustChangePassword: false },
    }),
  );
}
