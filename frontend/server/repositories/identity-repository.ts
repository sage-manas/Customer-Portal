import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Data access for tenants, users and their account links.
 *
 * Repositories are the only modules that import Prisma. That is what keeps
 * `tenantId` from becoming a convention: every function here either takes one
 * or is explicitly tenant-independent (host resolution, the operator realm),
 * so a service cannot accidentally issue an unscoped query — there is no
 * unscoped query to call.
 */

export function findTenantById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

export function findTenantBySlug(slug: string) {
  return prisma.tenant.findUnique({ where: { slug } });
}

export function findTenantByCustomDomain(customDomain: string) {
  return prisma.tenant.findUnique({ where: { customDomain } });
}

/** The default tenant for a single-tenant deployment: the only one there is. */
export async function findSoleTenant() {
  const tenants = await prisma.tenant.findMany({ take: 2, orderBy: { createdAt: "asc" } });
  return tenants.length === 1 ? tenants[0] : null;
}

export function findUserByEmail(tenantId: string, email: string) {
  return prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } },
    include: { accountLinks: true, tenant: true },
  });
}

export function findUserById(tenantId: string, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { accountLinks: true, tenant: true },
  });
}

export function recordLogin(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

/**
 * Transparently upgrades a hash whose cost parameters have fallen behind
 * policy. Best-effort: a failure here must never fail the login that
 * succeeded, so callers ignore the result.
 */
export function updatePasswordHash(userId: string, passwordHash: string) {
  return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

/**
 * Whether a sold-to account may use the portal (ADR-057).
 *
 * An account with no row is active: the row records a decision, and most
 * customers never had one taken about them.
 */
export async function isCustomerAccountActive(tenantId: string, sapKunnr: string) {
  const account = await prisma.customerAccount.findUnique({
    where: { tenantId_sapKunnr: { tenantId, sapKunnr } },
    select: { isActive: true },
  });
  return account?.isActive ?? true;
}

export function findOperatorByEmail(email: string) {
  return prisma.operator.findUnique({ where: { email: email.trim().toLowerCase() } });
}

export function recordOperatorLogin(id: string) {
  return prisma.operator.update({ where: { id }, data: { lastLoginAt: new Date() } });
}
