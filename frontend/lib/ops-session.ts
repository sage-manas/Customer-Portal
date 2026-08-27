import { sessionPlane } from "@cc/domain";
import type { OperatorClaims } from "@cc/service-platform";

import { getSession } from "./session";

/**
 * Migrated from client/apps/ops/lib/session.ts.
 *
 * apps/ops kept its own cookie pair (`cc_ops_access`/`cc_ops_refresh`) so
 * the two realms could sit on one browser. Phase 1 merges both apps into a
 * single Next app with one demo login, so the operator session is derived
 * from the same demo session — and only for a session whose *plane* is
 * `platform`, which is the distinction `sessionPlane` already draws
 * (ADR-062). A tenant or customer session resolves to null here, exactly as
 * a portal cookie would have in /client.
 *
 * TODO(BACKEND):
 * Restore the separate operator realm: its own cookie names, its own JWT
 * signed with OPS_AUTH_SECRET, verified by @cc/service-platform.
 */
export async function getOperatorSession(): Promise<OperatorClaims | null> {
  const session = await getSession();
  if (!session) return null;
  if (sessionPlane(session) !== "platform") return null;

  return { operatorId: session.userId, email: session.email, roles: session.roles };
}
