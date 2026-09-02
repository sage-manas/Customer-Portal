import type { SessionClaims } from "@cc/domain";

import { readSession, requestHost } from "@/server/auth/session";

/**
 * The session behind the current request.
 *
 * Every layout, page guard and nav filter in the app reads this, and the shape
 * it returns — `SessionClaims`, with `roles`, `kunnr` and `availableKunnrs` —
 * is unchanged from the Phase 1 demo version. That is deliberate: repointing
 * this one function at real authentication is what makes ~60 pages start
 * enforcing real sessions without any of them being edited.
 *
 * What changed underneath is everything that matters. The cookie is now an
 * HS256 JWT in an `HttpOnly` cookie, signed with AUTH_SECRET and verified on
 * every read, rather than a browser-written string naming a demo persona.
 */
export const ACCESS_COOKIE = "cc_access";

export async function getSession(): Promise<SessionClaims | null> {
  return readSession("web");
}

/**
 * Re-exported so the console's layout keeps its original import line
 * (`from "@/lib/session"`) — apps/ops had one session module, not two.
 */
export { getOperatorSession } from "./ops-session";

/** The request host, for tenant resolution (docs/02 §2). */
export async function getRequestHost(): Promise<string | null> {
  return requestHost();
}
