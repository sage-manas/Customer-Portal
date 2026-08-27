"use client";

import type { NavItem } from "@cc/domain";
import { AppShell, CartButton, type AccountOption } from "@cc/ui";
import { useRouter, usePathname } from "next/navigation";
import * as React from "react";

import { useCart } from "./CartProvider";
import { NotificationBellClient } from "./NotificationBellClient";

import { signOut as demoSignOut, switchKunnr } from "@/lib/demo-auth";

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

  // Logout is entirely client-side in this phase: clear the demo cookies and
  // leave. Route protection is restored the moment the cookie is gone —
  // middleware and every page guard read the same session.
  //
  // TODO(BACKEND):
  // Connect logout to server-side session invalidation.
  // Expected endpoint: POST /api/auth/logout
  const signOut = React.useCallback(() => {
    demoSignOut();
    router.replace("/login");
    router.refresh();
  }, [router]);

  // The switcher only ever selects a KUNNR the session is linked to —
  // `lib/session.ts` re-checks that against `availableKunnrs` on every read,
  // which is the same rule the real `switchAccount` enforces.
  //
  // TODO(BACKEND):
  // Expected endpoint: POST /api/auth/switch-account (re-issues the token
  // with the new `kunnr` claim).
  const switchAccount = React.useCallback(
    (kunnr: string) => {
      switchKunnr(kunnr);
      router.refresh();
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
      onSwitchAccount={switchAccount}
      onSignOut={signOut}
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
