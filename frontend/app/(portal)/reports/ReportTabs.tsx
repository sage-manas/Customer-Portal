"use client";

import { cn } from "@cc/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** The two reports docs/05 §7.10 specifies: sales dashboard and AR summary. */
const TABS = [
  { href: "/reports", label: "Sales dashboard" },
  { href: "/reports/ar", label: "AR summary" },
] as const;

export function ReportTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Reports" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = tab.href === "/reports" ? pathname === "/reports" : pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[12.5px] font-medium transition-colors duration-micro",
              active
                ? "border-accent-report text-accent-report"
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
