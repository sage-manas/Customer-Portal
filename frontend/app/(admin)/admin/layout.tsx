import { ADMIN_NAV, hasPermission, visibleNavItems } from "@cc/domain";
import { unreadNotificationCount } from "@cc/service-notification";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/components/AppShellClient";
import { RoleSwitcher } from "@/components/RoleSwitcher";
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
  // Middleware gates this too; this is the server-render half of the same
  // rule, and the half that still holds if middleware is ever bypassed.
  if (!hasPermission(session, "admin:view")) redirect("/403");

  const tenant = await resolveRequestTenant();
  const navItems = visibleNavItems(ADMIN_NAV, session, tenant?.moduleToggles);
  // The desk has a bell too — SLA breaches, new inquiries, credit requests.
  const unread = await unreadNotificationCount({
    tenantId: session.tenantId,
    userId: session.userId,
  });

  return (
    <AppShellClient
      navItems={navItems}
      tenantName={tenant?.name ?? "CustomerConnect"}
      tenantLogoUrl={tenant?.logoUrl}
      userEmail={session.email}
      unreadNotifications={unread}
    >
      {children}
      {/* Phase-1 scaffolding — see components/RoleSwitcher.tsx. */}
      <RoleSwitcher />
    </AppShellClient>
  );
}
