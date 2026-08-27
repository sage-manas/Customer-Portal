"use client";

import type { ModuleAccent, NavItem } from "@cc/domain";
import { activeNavItem } from "@cc/domain";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link, { useLinkStatus } from "next/link";

import { cn } from "../lib/cn";

import { NAV_ICONS } from "./nav-icons";

/**
 * Left sidebar (docs/05-UI-UX-DESIGN.md §4.2): 222px, collapsible to a 52px
 * icon rail, active item tinted with its module accent.
 *
 * It renders exactly what `items` contains — filter with `visibleNavItems`
 * from @cc/domain before passing them in, so RBAC and tenant module toggles
 * are applied in one place rather than per screen.
 */

export interface SidebarProps {
  items: readonly NavItem[];
  /** Current pathname; used for the active highlight (longest-prefix match). */
  pathname: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  className?: string;
}

const ACTIVE_ACCENT: Record<ModuleAccent, string> = {
  onboard: "border-accent-onboard bg-accent-onboard/10 text-accent-onboard",
  catalog: "border-accent-catalog bg-accent-catalog/10 text-accent-catalog",
  inquiry: "border-accent-inquiry bg-accent-inquiry/10 text-accent-inquiry",
  order: "border-accent-order bg-accent-order/10 text-accent-order",
  delivery: "border-accent-delivery bg-accent-delivery/10 text-accent-delivery",
  invoice: "border-accent-invoice bg-accent-invoice/10 text-accent-invoice",
  payment: "border-accent-payment bg-accent-payment/10 text-accent-payment",
  support: "border-accent-support bg-accent-support/10 text-accent-support",
  loyalty: "border-accent-loyalty bg-accent-loyalty/10 text-accent-loyalty",
  report: "border-accent-report bg-accent-report/10 text-accent-report",
};

/**
 * Lives inside the `Link` it labels — `useLinkStatus` only reports the
 * pending navigation of its nearest ancestor `<Link>`, so the icon and the
 * dot that mark "this is the one you clicked" have to render from here
 * rather than from `Sidebar` itself.
 */
function NavLinkContent({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) {
  const { pending } = useLinkStatus();
  const Icon = NAV_ICONS[item.icon];

  return (
    <>
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0", pending && "animate-pulse")}
        strokeWidth={1.75}
      />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <>
          <span className="truncate">{item.label}</span>
          {pending ? (
            <span
              aria-hidden
              className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-current"
            />
          ) : null}
        </>
      )}
    </>
  );
}

export function Sidebar({
  items,
  pathname,
  collapsed = false,
  onToggleCollapsed,
  className,
}: SidebarProps) {
  const active = activeNavItem(items, pathname);

  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-layer ease-portal",
        collapsed ? "w-[52px]" : "w-[222px]",
        className,
      )}
    >
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const isActive = active?.key === item.key;
          const planned = item.status === "planned";

          const linkClassName = cn(
            "flex items-center gap-2.5 rounded-sm border border-transparent px-2.5 py-2 text-[12.5px] font-medium transition-colors duration-micro ease-portal",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
            isActive
              ? item.accent
                ? ACTIVE_ACCENT[item.accent]
                : "border-primary bg-primary-subtle text-primary"
              : "text-text-mid hover:bg-primary-subtle",
            planned && "cursor-not-allowed text-text-dim hover:bg-transparent",
          );

          // Planned modules stay visible but inert: doc 05 §4.2 fixes the
          // module order, and a nav that changes shape every phase is more
          // disorienting for pilot tenants than one that shows what is
          // coming.
          if (planned) {
            return (
              <li key={item.key}>
                <a
                  aria-disabled
                  title={collapsed ? item.label : "Coming soon"}
                  className={linkClassName}
                >
                  <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <>
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-text-dim">
                        Soon
                      </span>
                    </>
                  )}
                </a>
              </li>
            );
          }

          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={linkClassName}
              >
                <NavLinkContent item={item} collapsed={collapsed} />
              </Link>
            </li>
          );
        })}
      </ul>

      {onToggleCollapsed ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-2.5 border-t border-border px-3.5 py-2.5 text-[11px] font-medium text-text-dim hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-4" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose aria-hidden className="size-4" strokeWidth={1.75} />
          )}
          <span className={collapsed ? "sr-only" : undefined}>Collapse</span>
        </button>
      ) : null}
    </nav>
  );
}
