import { PORTAL_NAV, hasPermission, visibleNavItems } from "@cc/domain";
import { getCartLineCount } from "@cc/service-catalogue";
import { unreadNotificationCount } from "@cc/service-notification";
import { redirect } from "next/navigation";

import { AppShellClient } from "@/components/AppShellClient";
import { CartProvider } from "@/components/CartProvider";
import { getSession } from "@/lib/session";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Customer-portal shell (docs/05-UI-UX-DESIGN.md §4.2, §5).
 *
 * Nav is filtered here, on the server, by the session's permissions and the
 * tenant's module toggles — the client never receives items it may not use.
 * That is presentation only: the API enforces the same permissions again
 * (docs/05 §4.3).
 *
 * The cart drawer is mounted here rather than in the catalogue route
 * because doc 05 §7.2 makes it persistent — it stays reachable from every
 * screen, so its state has to outlive navigation.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const tenant = await resolveRequestTenant();
  const navItems = visibleNavItems(PORTAL_NAV, session, tenant?.moduleToggles);

  const catalogue = navItems.find((item) => item.key === "catalogue");
  const showCart = Boolean(catalogue);
  // Seeded on the server so the badge is right on first paint rather than
  // popping in after a fetch. It is a count, not the cart: rendering the
  // shell must not pay for a full SAP repricing.
  const lineCount = showCart ? await getCartLineCount(session.tenantId, session.kunnr) : 0;
  // Same reasoning as the cart badge: a count, not the inbox. The panel
  // fetches the list when somebody opens it.
  const unread = await unreadNotificationCount({
    tenantId: session.tenantId,
    userId: session.userId,
  });

  // A CTA is offered only when the owning module is both permitted and
  // built — `status: "planned"` items exist in the nav but have no route yet.
  const moduleLive = (key: string) => navItems.some((i) => i.key === key && i.status === "live");

  return (
    <CartProvider
      initialLineCount={lineCount}
      canManage={hasPermission(session, "cart:manage")}
      canCreateOrder={hasPermission(session, "order:create") && moduleLive("orders")}
      canRequestQuote={hasPermission(session, "inquiry:create") && moduleLive("inquiries")}
    >
      <AppShellClient
        navItems={navItems}
        tenantName={tenant?.name ?? "CustomerConnect"}
        tenantLogoUrl={tenant?.logoUrl}
        userEmail={session.email}
        activeKunnr={session.kunnr}
        accounts={session.availableKunnrs.map((kunnr) => ({ kunnr, label: `Account ${kunnr}` }))}
        showCart={showCart}
        unreadNotifications={unread}
      >
        {children}
      </AppShellClient>
    </CartProvider>
  );
}
