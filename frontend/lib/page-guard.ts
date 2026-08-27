import { hasPermission, type Permission } from "@cc/domain";
import type { OperatorClaims } from "@cc/service-platform";
import { redirect } from "next/navigation";

import { getOperatorSession } from "./ops-session";

/**
 * Migrated verbatim from client/apps/ops/lib/page-guard.ts.
 *
 * Page-level permission check for the console's server components. The
 * console's screens read the service directly in a server component, so
 * without this, typing a URL would render the operator list to a
 * `sap_manager` whose nav merely did not offer the link. Hiding a tab is
 * presentation; this is the control.
 *
 * `/403` rather than a 404: the operator is legitimately inside this console
 * and lacks one capability within it. The 404 rule is about cross-tenant and
 * cross-customer reads, and the platform plane has neither.
 */
export async function requireOperatorPage(permission: Permission): Promise<OperatorClaims> {
  const session = await getOperatorSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, permission)) redirect("/403");
  return session;
}
