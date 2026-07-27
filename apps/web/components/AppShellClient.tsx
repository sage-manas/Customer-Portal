"use client";

import type { NavItem } from "@cc/domain";
import { AppShell, CartButton, type AccountOption } from "@cc/ui";
import { useRouter, usePathname } from "next/navigation";
import * as React from "react";

import { useCart } from "./CartProvider";

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
}) {
  const router = useRouter();
  const pathname = usePathname();

  const signOut = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }, [router]);

  const switchAccount = React.useCallback(
    async (kunnr: string) => {
      const response = await fetch("/api/auth/switch-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kunnr }),
      });
      if (response.ok) router.refresh();
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
