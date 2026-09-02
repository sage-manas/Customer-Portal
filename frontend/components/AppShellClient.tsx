"use client";

import type { NavItem } from "@cc/domain";
import { AppShell, CartButton, type AccountOption } from "@cc/ui";
import { useRouter, usePathname } from "next/navigation";
import * as React from "react";

import { useCart } from "./CartProvider";
import { NotificationBellClient } from "./NotificationBellClient";

import { signOut, switchKunnr } from "@/lib/auth-client";

/**
 * Client wrapper around the `@cc/ui` AppShell.
 *
 * The shell needs the current pathname (active nav highlight) and callbacks
 * (sign out, account switch) — all client concerns. Everything it renders
 * is decided on the server: nav items arrive pre-filtered by RBAC and the
 * tenant's module toggles, so no permission logic runs in the browser.
 */
export function AppShellClient({
  navItems,
  tenantName,
  tenantLogoUrl,
  userEmail,
  accounts,
  activeKunnr,
  children,
  banner,
  showCart = false,
  unreadNotifications = 0,
}: {
  navItems: NavItem[];
  tenantName: string;
  tenantLogoUrl?: string | null;
  userEmail: string;
  accounts?: AccountOption[];
  activeKunnr?: string;
  children: React.ReactNode;
  banner?: React.ReactNode;
  /** The back-office shell has no cart; only the customer plane does. */
  showCart?: boolean;
  /** Seeded on the server so the bell's badge is right on first paint. */
  unreadNotifications?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // The session cookies are HttpOnly, so signing out is a request rather than
  // a cookie the browser can clear itself. The redirect happens either way: if
  // the call fails the cookie may survive, and leaving the user on a page that
  // still looks signed-in would be worse than a redirect to a login screen that
  // bounces them back.
  const onSignOut = React.useCallback(() => {
    void signOut().finally(() => {
      router.replace("/login");
      router.refresh();
    });
  }, [router]);

  // Switching re-issues the token with the new `kunnr` claim, and the server
  // re-checks the link against the database before it does — the token's own
  // `availableKunnrs` is not treated as evidence, because it was minted before
  // whatever changed since.
  const onSwitchAccount = React.useCallback(
    (kunnr: string) => {
      void switchKunnr(kunnr)
        .then(() => router.refresh())
        .catch(() => router.refresh());
    },
    [router],
  );

  return (
    <AppShell
      navItems={navItems}
      pathname={pathname}
      tenantName={tenantName}
      tenantLogoUrl={tenantLogoUrl}
      userEmail={userEmail}
      accounts={accounts}
      activeKunnr={activeKunnr}
      onSwitchAccount={onSwitchAccount}
      onSignOut={onSignOut}
      banner={banner}
      actions={showCart ? <CartTrigger /> : undefined}
      notifications={<NotificationBellClient initialUnreadCount={unreadNotifications} />}
    >
      {children}
    </AppShell>
  );
}

/** Split out so the cart context is only read when the cart is shown. */
function CartTrigger() {
  const { lineCount, open } = useCart();
  return <CartButton count={lineCount} onClick={open} />;
}
