import type { Permission, SessionClaims } from "@cc/domain";
import { hasPermission } from "@cc/domain";

import { AuthError } from "./errors";

/**
 * RBAC enforcement. Permission checks live at the API layer, not the UI
 * (docs/02 §3, docs/05 §4.3) — the nav registry hides what a user can't do,
 * these functions are what actually stops them.
 */

/** Throws `AuthError("session_invalid")` when there is no session. */
export function requireSession(session: SessionClaims | null | undefined): SessionClaims {
  if (!session) throw new AuthError("session_invalid");
  return session;
}

export function requirePermission(
  session: SessionClaims | null | undefined,
  permission: Permission,
): SessionClaims {
  const current = requireSession(session);
  if (!hasPermission(current, permission)) throw new AuthError("forbidden");
  return current;
}

/**
 * Asserts the session may act for `kunnr`. One user may hold several
 * sold-to accounts (docs/05 §4.2); asking for one they don't hold is
 * treated as *not found*, so the portal never confirms that another
 * customer's account exists (docs/05 §8: "never leak existence").
 */
export function requireCustomerAccount(
  session: SessionClaims | null | undefined,
  kunnr: string,
): SessionClaims {
  const current = requireSession(session);
  if (!current.availableKunnrs.includes(kunnr)) throw new AuthError("forbidden");
  return current;
}

/** The KUNNR a request should read, defaulting to the session's active one. */
export function resolveActiveKunnr(
  session: SessionClaims | null | undefined,
  requested?: string,
): string {
  const current = requireSession(session);
  if (requested) {
    requireCustomerAccount(current, requested);
    return requested;
  }
  if (!current.kunnr) throw new AuthError("forbidden");
  return current.kunnr;
}
