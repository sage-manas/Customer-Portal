"use client";

import { Bell, ChevronDown, LogOut, Search } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Top bar (docs/05-UI-UX-DESIGN.md §4.2): 52px, `--color-nav` chrome,
 * tenant logo + product name, global search (⌘K), notifications bell, and
 * the user menu with the sold-to account switcher — one user may act for
 * several accounts (docs/02 §3).
 */

export interface AccountOption {
  /** SAP KUNNR. */
  kunnr: string;
  label: string;
}

export interface TopBarProps {
  tenantName: string;
  tenantLogoUrl?: string | null;
  userEmail: string;
  accounts?: readonly AccountOption[];
  activeKunnr?: string;
  onSwitchAccount?: (kunnr: string) => void;
  onSearch?: () => void;
  onSignOut?: () => void;
  notificationCount?: number;
  /**
   * The bell. A `<NotificationBell />` wired to the inbox API when the app
   * passes one; without it the bar falls back to a static bell carrying
   * `notificationCount`, which is what Storybook and any shell not yet wired
   * render. The slot exists because fetching belongs to the app — @cc/ui
   * renders what it is given.
   */
  notifications?: React.ReactNode;
  /**
   * Module-owned controls placed left of the bell — the cart trigger is the
   * first (docs/05 §7.2, persistent drawer). The shell renders whatever it
   * is given and knows nothing about carts.
   */
  actions?: React.ReactNode;
  className?: string;
}

export function TopBar({
  tenantName,
  tenantLogoUrl,
  userEmail,
  accounts = [],
  activeKunnr,
  onSwitchAccount,
  onSearch,
  onSignOut,
  notificationCount = 0,
  notifications,
  actions,
  className,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);

  // ⌘K / Ctrl-K opens the command palette (docs/05 §4.2, §9 keyboard).
  React.useEffect(() => {
    if (!onSearch) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSearch]);

  const active = accounts.find((account) => account.kunnr === activeKunnr);

  return (
    <header
      className={cn("flex h-[52px] shrink-0 items-center gap-3 bg-nav px-4 text-white", className)}
    >
      <div className="flex items-center gap-2.5">
        {tenantLogoUrl ? (
          // A plain <img>: @cc/ui is framework-agnostic and cannot import
          // next/image. Tenant logos are small, tenant-uploaded assets.
          <img src={tenantLogoUrl} alt="" className="h-6 w-auto" />
        ) : null}
        <span className="text-[13px] font-bold tracking-tight">{tenantName}</span>
        <span aria-hidden className="text-white/30">
          /
        </span>
        <span className="text-[12.5px] text-white/70">CustomerConnect</span>
      </div>

      {onSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className="ml-4 hidden min-w-64 items-center gap-2 rounded-sm bg-white/10 px-2.5 py-1.5 text-[12px] text-white/70 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:flex"
        >
          <Search aria-hidden className="size-3.5" strokeWidth={1.75} />
          Search orders, invoices, materials
          <kbd className="ml-auto font-mono text-[10px] text-white/50">⌘K</kbd>
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {actions}
        {notifications ?? (
          <button
            type="button"
            aria-label={
              notificationCount > 0
                ? `Notifications (${notificationCount} unread)`
                : "Notifications"
            }
            className="relative rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Bell aria-hidden className="size-4" strokeWidth={1.75} />
            {notificationCount > 0 ? (
              <span className="absolute right-1 top-1 size-2 rounded-pill bg-danger" />
            ) : null}
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <span className="hidden flex-col leading-tight sm:flex">
              <span className="text-[12px]">{userEmail}</span>
              {active ? (
                <span className="font-mono text-[10px] text-white/60">{active.kunnr}</span>
              ) : null}
            </span>
            <ChevronDown aria-hidden className="size-3.5" strokeWidth={1.75} />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-border bg-surface py-1 text-text shadow-md"
            >
              {accounts.length > 1 ? (
                <>
                  <p className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
                    Acting for
                  </p>
                  {accounts.map((account) => (
                    <button
                      key={account.kunnr}
                      type="button"
                      role="menuitemradio"
                      aria-checked={account.kunnr === activeKunnr}
                      onClick={() => {
                        setMenuOpen(false);
                        onSwitchAccount?.(account.kunnr);
                      }}
                      className={cn(
                        "flex w-full flex-col items-start px-3 py-2 text-left text-[12.5px] hover:bg-primary-subtle",
                        account.kunnr === activeKunnr && "bg-primary-subtle text-primary",
                      )}
                    >
                      {account.label}
                      <span className="font-mono text-[10.5px] text-text-dim">{account.kunnr}</span>
                    </button>
                  ))}
                  <hr className="my-1 border-border" />
                </>
              ) : null}

              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-primary-subtle"
              >
                <LogOut aria-hidden className="size-3.5" strokeWidth={1.75} />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
