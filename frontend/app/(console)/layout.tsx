import { OPS_NAV, visibleNavItems } from "@cc/domain";
import { redirect } from "next/navigation";

import { OpsShell } from "@/components/OpsShell";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { getOperatorSession } from "@/lib/session";

/**
 * The console shell (doc 09 §3.3: "nav filtered by `visibleNavItems` with
 * ops nav registry — `sap_manager` sees only SAP Config + SAP Health").
 *
 * That sentence is the whole implementation: the same `visibleNavItems`
 * the portal and the back office use, over the same permission registry,
 * against a third list of rows. No role is named here, no branch decides
 * what a SAP manager may see — which is the payoff doc 09 §3.1 predicted
 * when it said the nav "needs no logic change".
 *
 * `middleware.ts` has already gated `platform:operate` before this renders;
 * the redirect below is the server-render half of the same rule, exactly as
 * apps/web's admin layout does it.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getOperatorSession();
  if (!session) redirect("/login");

  // No module toggles: those are a *tenant's* opt-outs (docs/02 §2), and
  // the console belongs to the platform, not to any tenant.
  const navItems = visibleNavItems(OPS_NAV, session);

  return (
    <OpsShell navItems={navItems} operatorEmail={session.email}>
      {children}
      {/* Phase-1 scaffolding — see components/RoleSwitcher.tsx. */}
      <RoleSwitcher />
    </OpsShell>
  );
}
