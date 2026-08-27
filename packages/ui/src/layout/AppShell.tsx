"use client";

import type { NavItem } from "@cc/domain";
import * as React from "react";

import { cn } from "../lib/cn";

import { Sidebar, type SidebarProps } from "./Sidebar";
import { TopBar, type TopBarProps } from "./TopBar";

/**
 * App shell (docs/05-UI-UX-DESIGN.md §5): top bar + sidebar + scrollable
 * content with 24–28px padding, max content width 1440px centered.
 *
 * The same shell serves the customer portal and the tenant back-office —
 * only the nav items differ (docs/05 §8: "same shell, denser") — so screens
 * never build their own chrome.
 *
 * Sidebar collapse state is persisted per user (docs/05 §4.2); localStorage
 * is the Phase 1 store, moving to a user-preferences table when one exists.
 */

const COLLAPSE_STORAGE_KEY = "cc.sidebar.collapsed";

export interface AppShellProps extends TopBarProps {
  navItems: readonly NavItem[];
  pathname: string;
  children: React.ReactNode;
  /** Rendered above the page content — e.g. the SAP stale-data banner. */
  banner?: React.ReactNode;
  /** Passed straight to `Sidebar` — see its `renderLink`. */
  renderNavLink?: SidebarProps["renderLink"];
  contentClassName?: string;
}

export function AppShell({
  navItems,
  pathname,
  children,
  banner,
  renderNavLink,
  contentClassName,
  ...topBar
}: AppShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

  // Below 1280px the sidebar auto-collapses to the icon rail (docs/05 §5).
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const apply = (matches: boolean) => {
      if (matches) setCollapsed(true);
    };
    apply(query.matches);
    const listener = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <TopBar {...topBar} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          items={navItems}
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapsed={toggle}
          renderLink={renderNavLink}
          className="hidden md:flex"
        />
        <main className={cn("min-w-0 flex-1 overflow-y-auto", contentClassName)}>
          <div className="mx-auto flex max-w-[1440px] flex-col gap-5 p-6 lg:p-7">
            {banner}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Page header used inside the shell: title, subtitle, freshness, actions. */
export interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  /** Typically a <SapSyncIndicator /> (docs/05 §6.1). */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text">{title}</h1>
          {meta}
        </div>
        {subtitle ? <p className="text-[12.5px] text-text-dim">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
