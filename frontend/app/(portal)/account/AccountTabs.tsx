"use client";

import { cn } from "@cc/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The two panels docs/05 §7.9 splits Module 9 into — credit position and
 * loyalty & rebates — as tabs rather than one long page, because they answer
 * different questions and a customer arrives for one or the other.
 *
 * Company profile, users and addresses (docs/05 §4.1's other `/account` tabs)
 * are not built yet and are deliberately absent rather than shown disabled:
 * unlike the sidebar's planned modules, these would be tabs on a page the
 * customer is already on, and a dead tab beside two live ones reads as broken
 * rather than as forthcoming.
 */

const TABS = [
  { href: "/account", label: "Credit position" },
  { href: "/account/loyalty", label: "Loyalty & rebates" },
] as const;

export function AccountTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account sections" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        // Exact match on the index tab, prefix elsewhere, so
        // /account/credit/request keeps "Credit position" lit.
        const active =
          tab.href === "/account" ? pathname === "/account" : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              active
                ? "border-accent-loyalty text-accent-loyalty"
                : "border-transparent text-text-mid hover:text-text",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
