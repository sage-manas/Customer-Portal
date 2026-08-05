import { OPS_NAV, visibleNavItems } from "@cc/domain";
import { PageHeader } from "@cc/ui";
import { redirect } from "next/navigation";

import { getOperatorSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The console root has no content of its own: it forwards to the first tab
 * the operator can actually open.
 *
 * Before the five-tier model this was the tenant list, which worked because
 * every operator could see it. `sap_manager` cannot (doc 09 §2), and a
 * landing page that 403s for a whole role is a console that appears broken
 * to the person it was built for. Deriving the destination from
 * `visibleNavItems` rather than branching on the role means a new tab, or a
 * permission moved between groups, lands somebody somewhere sensible with
 * nothing here to update.
 */
export default async function OpsHomePage() {
  const session = await getOperatorSession();
  if (!session) redirect("/login");

  const [first] = visibleNavItems(OPS_NAV, session);
  if (first) redirect(first.href);

  // Reachable only for a session that holds `platform:operate` and nothing
  // else — a role misconfiguration rather than an attack, so it gets an
  // explanation instead of a 403.
  return (
    <PageHeader
      title="No consoles available"
      subtitle="This operator account holds no platform capabilities. Ask a super admin to review its roles."
    />
  );
}
