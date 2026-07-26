import { ADMIN_NAV, visibleNavItems } from "@cc/domain";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/components/AppShellClient";
import { getSession } from "@/lib/session";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Tenant back-office shell (docs/05-UI-UX-DESIGN.md §8) — same design
 * system and shell as the customer portal, different nav. Route-level
 * access is also gated in middleware.ts (`admin:view`); this check is the
 * server-render half of the same rule.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenant = await resolveRequestTenant();
  const navItems = visibleNavItems(ADMIN_NAV, session, tenant?.moduleToggles);

  return (
    <AppShellClient
      navItems={navItems}
      tenantName={tenant?.name ?? "CustomerConnect"}
      tenantLogoUrl={tenant?.logoUrl}
      userEmail={session.email}
    >
      {children}
    </AppShellClient>
  );
}
