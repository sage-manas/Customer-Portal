import type { Permission } from "@cc/domain";
import { hasPermission } from "@cc/domain";

import { PlatformError } from "./errors";
import type { OperatorClaims } from "./jwt";

/**
 * RBAC enforcement for the operator realm — the mirror of
 * `@cc/service-identity`'s `guard.ts` (doc 09 §3.3: "requirePermission
 * middleware mirrors the web app's").
 *
 * Its own file, with no `@cc/db` import, for the same reason that one has:
 * the guard is pure, so the route x role matrix test can execute it without
 * a database, and the console's enforcement is provable in a unit test
 * rather than only in an integration suite somebody may skip locally.
 */

/** Throws when there is no operator session. The `requireX` counterpart of `@cc/service-identity`'s `requireSession`. */
export function requireOperatorSession(claims: OperatorClaims | null | undefined): OperatorClaims {
  if (!claims) throw new PlatformError("session_invalid");
  return claims;
}

/**
 * The console's enforcement point.
 *
 * Reads the same `ROLE_PERMISSIONS` registry the portal does, even though
 * the realms share no token, no cookie and no error class: two permission
 * tables is how `platform:sap-config` comes to mean one thing in
 * `rolesWithPermission` and another in the console. What the realms keep
 * separate is *who can hold* a role, which `verifyOperatorToken` decides at
 * the parse by dropping every non-platform role.
 */
export function requireOperatorPermission(
  claims: OperatorClaims | null | undefined,
  permission: Permission,
): OperatorClaims {
  const current = requireOperatorSession(claims);
  if (!hasPermission(current, permission)) throw new PlatformError("forbidden");
  return current;
}
