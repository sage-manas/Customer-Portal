"use client";

import type { NotificationSeverity } from "@cc/domain";
import { AlertTriangle, Bell, CheckCircle2, Info, Loader2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { relativeTime } from "../lib/relative-time";

/**
 * The bell inbox (docs/05-UI-UX-DESIGN.md §6.4 and §4.2's top bar).
 *
 * It renders what it is given and decides nothing: the severity, the words
 * and the deep link were all fixed by the `@cc/domain` template registry
 * when the event was fanned out, so a notification reads the same in the
 * bell, in the email and in a future WhatsApp mirror (CLAUDE.md rule 3).
 *
 * The component owns exactly one behaviour of its own — opening and closing
 * the panel — because that is the only thing on this screen the server has
 * no opinion about.
 */

export interface NotificationItem {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
  read: boolean;
  /** ISO; the moment the *fact* happened, not the moment it was relayed. */
  occurredAt: string;
}

export interface NotificationBellProps {
  items: readonly NotificationItem[];
  unreadCount: number;
  loading?: boolean;
  error?: string;
  onOpen?: () => void;
  /** Follows the deep link; the route re-checks the permission (docs/05 §4.3). */
  onSelect?: (item: NotificationItem) => void;
  onMarkAllRead?: () => void;
  /** Injectable so stories and tests don't depend on the wall clock. */
  now?: Date;
  className?: string;
}

const SEVERITY = {
  info: { Icon: Info, className: "text-primary" },
  success: { Icon: CheckCircle2, className: "text-success" },
  warning: { Icon: AlertTriangle, className: "text-warning" },
  critical: { Icon: TriangleAlert, className: "text-danger" },
} as const satisfies Record<NotificationSeverity, { Icon: typeof Info; className: string }>;

export function NotificationBell({
  items,
  unreadCount,
  loading = false,
  error,
  onOpen,
  onSelect,
  onMarkAllRead,
  now,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);

  // Click-away and Escape. A panel that only closes by clicking the bell
  // again is the kind of thing that survives review and annoys every user.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      if (!current) onOpen?.();
      return !current;
    });
  };

  return (
    <div ref={container} className={cn("relative", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications, none unread"
        }
        className="relative rounded-sm p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <Bell aria-hidden className="size-4" strokeWidth={1.75} />
        {unreadCount > 0 ? (
          // A count, not just a dot: "you have something" and "you have
          // eleven things" are different messages, and the dot alone made
          // the old bell indistinguishable from decoration.
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-pill bg-danger px-1 text-[9.5px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-1 w-[22rem] overflow-hidden rounded-md border border-border bg-surface text-text shadow-md"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.8px] text-text-dim">
              Notifications
            </p>
            {unreadCount > 0 && onMarkAllRead ? (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[11.5px] font-semibold text-primary hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {loading ? (
              <p className="flex items-center gap-2 px-3 py-6 text-[12.5px] text-text-dim">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Loading your notifications…
              </p>
            ) : error ? (
              <p className="px-3 py-6 text-[12.5px] text-danger">{error}</p>
            ) : items.length === 0 ? (
              // docs/05 §6.3's empty-state rule: say what the space is for.
              <p className="px-3 py-6 text-[12.5px] text-text-dim">
                Nothing yet. Order confirmations, quotations and ticket updates land here.
              </p>
            ) : (
              <ul>
                {items.map((item) => {
                  const { Icon, className: tone } = SEVERITY[item.severity];
                  return (
                    <li key={item.id}>
                      <a
                        href={item.href}
                        role="menuitem"
                        onClick={(event) => {
                          if (!onSelect) return;
                          event.preventDefault();
                          setOpen(false);
                          onSelect(item);
                        }}
                        className={cn(
                          "flex gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-primary-subtle",
                          !item.read && "bg-primary-subtle/40",
                        )}
                      >
                        <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            className={cn(
                              "text-[12.5px] leading-snug",
                              item.read ? "text-text" : "font-semibold text-text",
                            )}
                          >
                            {item.title}
                          </span>
                          <span className="text-[11.5px] leading-snug text-text-dim">
                            {item.body}
                          </span>
                          <span className="text-[10.5px] text-text-dim">
                            {relativeTime(item.occurredAt, now)}
                          </span>
                        </span>
                        {!item.read ? (
                          <span
                            aria-label="Unread"
                            className="mt-1 size-1.5 shrink-0 rounded-pill bg-primary"
                          />
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
