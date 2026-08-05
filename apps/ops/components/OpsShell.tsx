"use client";

import type { NavItem } from "@cc/domain";
import { AppShell } from "@cc/ui";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

/**
 * Client wrapper around `@cc/ui`'s AppShell for the operator console — the
 * twin of apps/web's `AppShellClient`, and deliberately the same shell
 * rather than a second one: doc 05's chrome is the product's chrome, and an
 * ops console that looks like a different application is one more thing to
 * maintain for no benefit.
 *
 * What differs is everything the shell is *given*: the nav comes from
 * `OPS_NAV` filtered on the server, there is no tenant (an operator is not
 * scoped to one, so the bar carries the console's own name), no account
 * switcher (no KUNNR in this realm) and no bell (nothing in the platform
 * plane writes notifications). No permission logic runs here — the items
 * arrive already filtered.
 */
export function OpsShell({
  navItems,
  operatorEmail,
  children,
}: {
  navItems: NavItem[];
  operatorEmail: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const signOut = React.useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }, [router]);

  return (
    <AppShell
      navItems={navItems}
      pathname={pathname}
      tenantName="CustomerConnect Ops"
      userEmail={operatorEmail}
      onSignOut={signOut}
    >
      {children}
    </AppShell>
  );
}
