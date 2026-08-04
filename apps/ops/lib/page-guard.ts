import { hasPermission, type Permission } from "@cc/domain";
import type { OperatorClaims } from "@cc/service-platform";
import { redirect } from "next/navigation";

import { getOperatorSession } from "./session";

/**
 * Page-level permission check for the console's server components.
 *
 * `lib/route.ts` guards the API, which is where enforcement lives (CLAUDE.md
 * rule 5); this guards the *render*, because a screen is not only a way to
 * call an API. `/operators` fetches nothing from `/api/operators` on first
 * paint — it reads the service directly in a server component — so without
 * this, typing the URL would render the operator list to a `sap_manager`
 * whose nav merely did not offer the link. Hiding a tab is presentation;
 * this is the server-render half of the same rule apps/web's admin layout
 * applies with its `admin:view` redirect.
 *
 * `/403` rather than a 404: the operator is legitimately inside this console
 * and lacks one capability within it, which is exactly the case doc 09 §1
 * reserves 403 for. The 404 rule is about cross-tenant and cross-customer
 * reads, and the platform plane has neither.
 */
export async function requireOperatorPage(permission: Permission): Promise<OperatorClaims> {
  const session = await getOperatorSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, permission)) redirect("/403");
  return session;
}
