import { PORTAL_NAV, visibleNavItems } from "@cc/domain";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/components/AppShellClient";
import { getSession } from "@/lib/session";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Customer-portal shell (docs/05-UI-UX-DESIGN.md §4.2, §5).
 *
 * Nav is filtered here, on the server, by the session's permissions and the
 * tenant's module toggles — the client never receives items it may not use.
 * That is presentation only: the API enforces the same permissions again
 * (docs/05 §4.3).
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenant = await resolveRequestTenant();
  const navItems = visibleNavItems(PORTAL_NAV, session, tenant?.moduleToggles);

  return (
    <AppShellClient
      navItems={navItems}
      tenantName={tenant?.name ?? "CustomerConnect"}
      tenantLogoUrl={tenant?.logoUrl}
      userEmail={session.email}
      activeKunnr={session.kunnr}
      accounts={session.availableKunnrs.map((kunnr) => ({ kunnr, label: `Account ${kunnr}` }))}
    >
      {children}
    </AppShellClient>
  );
}
