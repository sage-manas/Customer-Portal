import { isPlatformRole, type Role } from "@cc/domain";

import { readSession } from "@/server/auth/session";

export interface OperatorClaims {
  operatorId: string;
  email: string;
  roles: Role[];
}

/**
 * The operator session, read from the platform realm's own cookie.
 *
 * Phase 1 derived this from the single demo session and merely checked its
 * plane. It is now a genuinely separate realm again, as it was in apps/ops:
 * its own cookie pair (`cc_ops_access`/`cc_ops_refresh`) signed with
 * OPS_AUTH_SECRET, so a tenant session — however privileged inside its tenant
 * — cannot be presented here, and a leak of either realm's secret cannot forge
 * a token in the other (ADR-045).
 *
 * The plane is re-checked on top of the signature: a token that verifies but
 * carries no platform role is not an operator, and the console must not treat
 * it as one.
 */
export async function getOperatorSession(): Promise<OperatorClaims | null> {
  const session = await readSession("ops");
  if (!session) return null;

  const roles = session.roles.filter(isPlatformRole);
  if (roles.length === 0) return null;

  return { operatorId: session.userId, email: session.email, roles };
}
