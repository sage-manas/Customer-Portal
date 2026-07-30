import { parseEventPayload, renderNotifications, type DomainEventName } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { NotificationBell, type NotificationItem } from "./NotificationBell";

/**
 * Every item is produced by `renderNotifications` against a real event
 * payload rather than typed out by hand. A story with invented copy would
 * drift from what a customer actually receives the moment a template
 * changes — and the whole point of the registry is that the bell, the email
 * and the mirror say the same thing.
 */
const NOW = new Date("2026-07-29T12:00:00.000Z");

function item<N extends DomainEventName>(
  id: string,
  name: N,
  payload: unknown,
  options: { read?: boolean; minutesAgo?: number } = {},
): NotificationItem {
  const occurredAt = new Date(NOW.getTime() - (options.minutesAgo ?? 5) * 60_000);
  const [rendered] = renderNotifications(
    name,
    parseEventPayload(name, { ...(payload as object), occurredAt }),
  );
  return {
    id,
    severity: rendered!.severity,
    title: rendered!.title,
    body: rendered!.body,
    href: rendered!.href,
    read: options.read ?? false,
    occurredAt: occurredAt.toISOString(),
  };
}

const items: NotificationItem[] = [
  item("1", "order.created", {
    kunnr: "0010001001",
    documentNumber: "0000004711",
    creditBlocked: false,
  }),
  item(
    "2",
    "quotation.issued",
    {
      kunnr: "0010001001",
      documentNumber: "0020000001",
      validUntil: "2026-08-31",
      grossValue: 1_250_000,
      currency: "INR",
    },
    { minutesAgo: 90 },
  ),
  item(
    "3",
    "order.created",
    { kunnr: "0010001001", documentNumber: "0000004712", creditBlocked: true },
    { minutesAgo: 300, read: true },
  ),
  item(
    "4",
    "support.ticket.resolved",
    { ticketId: "tkt_1", ticketNo: "TKT-000042", kunnr: "0010001001" },
    { minutesAgo: 1500, read: true },
  ),
];

const meta: Meta<typeof NotificationBell> = {
  title: "Layout/NotificationBell",
  component: NotificationBell,
  parameters: { layout: "centered" },
  args: { now: NOW, items, unreadCount: 2 },
  decorators: [
    // The bell lives in the dark top bar, so it is shown on one.
    (Story) => (
      <div className="flex h-[52px] w-[28rem] items-center justify-end bg-nav px-4 text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NotificationBell>;

/** Two unread items; click the bell to open the panel. */
export const WithUnread: Story = {};

/** Nothing has happened yet — the empty state names what will land here. */
export const Empty: Story = {
  args: { items: [], unreadCount: 0 },
};

/** A badge caps at 99+ rather than widening the top bar. */
export const ManyUnread: Story = {
  args: { unreadCount: 128 },
};

export const Loading: Story = {
  args: { items: [], unreadCount: 0, loading: true },
};

/** The inbox is the portal's own data, so a failure here is the portal's. */
export const Failed: Story = {
  args: {
    items: [],
    unreadCount: 0,
    error: "We couldn't load your notifications. Try again in a moment.",
  },
};
