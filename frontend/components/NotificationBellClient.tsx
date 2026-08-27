"use client";

import { NotificationBell, type NotificationItem } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * The bell, wired to `/api/notifications`.
 *
 * `@cc/ui` renders what it is given, so the fetching lives here — the same
 * split as the cart. Three deliberate choices:
 *
 * - The unread **count** is seeded on the server (the layout already loads a
 *   session) so the badge is right on first paint rather than popping in.
 * - The **list** is fetched when the panel opens, not on every page load.
 *   A notification list is the definition of something nobody looks at most
 *   of the time, and rendering the shell must not pay for it.
 * - The count is re-polled on a slow interval. A minute is chosen against
 *   the relay tick (2s) and the SLA sweep (60s): faster would ask the
 *   database a question whose answer changes on the order of minutes.
 */

const POLL_INTERVAL_MS = 60_000;

interface InboxResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export function NotificationBellClient({ initialUnreadCount }: { initialUnreadCount: number }) {
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(initialUnreadCount);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [loadedOnce, setLoadedOnce] = React.useState(false);

  const load = React.useCallback(async (options: { withList: boolean }) => {
    if (options.withList) setLoading(true);
    try {
      const response = await demoFetch(`/api/notifications?limit=${options.withList ? 20 : 1}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(String(response.status));

      const data = (await response.json()) as InboxResponse;
      setUnreadCount(data.unreadCount);
      if (options.withList) {
        setItems(data.notifications);
        setLoadedOnce(true);
      }
      setError(undefined);
    } catch {
      // Only the open panel says so. A failed background poll must not put an
      // error in a top bar the user isn't looking at.
      if (options.withList) {
        setError("We couldn't load your notifications. Try again in a moment.");
      }
    } finally {
      if (options.withList) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const timer = setInterval(() => void load({ withList: false }), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const markAllRead = React.useCallback(async () => {
    // Optimistic: the panel is open and the user just pressed the button, so
    // the badge should clear now. A failed request restores it on the next
    // poll rather than flashing an error over a cosmetic action.
    setUnreadCount(0);
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    await demoFetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => undefined);
  }, []);

  const select = React.useCallback(
    async (item: NotificationItem) => {
      if (!item.read) {
        setUnreadCount((count) => Math.max(0, count - 1));
        await demoFetch("/api/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [item.id] }),
        }).catch(() => undefined);
      }
      // A client-side navigation, so the deep link lands in the same shell —
      // and the destination route enforces the permission again.
      router.push(item.href);
    },
    [router],
  );

  return (
    <NotificationBell
      items={items}
      unreadCount={unreadCount}
      loading={loading && !loadedOnce}
      error={error}
      onOpen={() => void load({ withList: true })}
      onSelect={(item) => void select(item)}
      onMarkAllRead={() => void markAllRead()}
    />
  );
}
