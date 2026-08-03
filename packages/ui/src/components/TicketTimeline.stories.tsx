import { buildTicketTimeline } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { TicketTimeline } from "./TicketTimeline";

/**
 * Stages come from `buildTicketTimeline`, never from hand-written arrays —
 * the reopened story below is only interesting because the domain function
 * really does produce it.
 */
const OPENED = new Date("2026-07-27T09:00:00.000Z");
const STARTED = new Date("2026-07-27T11:30:00.000Z");
const RESOLVED = new Date("2026-07-28T15:00:00.000Z");

const meta = {
  title: "Domain/TicketTimeline",
  component: TicketTimeline,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TicketTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { stages: buildTicketTimeline({ status: "open", openedAt: OPENED }) },
};

export const InProgress: Story = {
  args: {
    stages: buildTicketTimeline({ status: "in_progress", openedAt: OPENED, startedAt: STARTED }),
  },
};

export const Resolved: Story = {
  args: {
    stages: buildTicketTimeline({
      status: "resolved",
      openedAt: OPENED,
      startedAt: STARTED,
      resolvedAt: RESOLVED,
    }),
  },
};

export const Closed: Story = {
  args: {
    stages: buildTicketTimeline({
      status: "closed",
      openedAt: OPENED,
      startedAt: STARTED,
      resolvedAt: RESOLVED,
      closedAt: new Date("2026-07-29T08:00:00.000Z"),
    }),
  },
};

/**
 * A reopened ticket: back at Open, with the earlier dates still showing.
 * They are history — the ticket really was resolved on the 28th — but the
 * stepper reports where it is now, not where it has been.
 */
export const Reopened: Story = {
  args: {
    stages: buildTicketTimeline({
      status: "open",
      openedAt: new Date("2026-07-29T09:00:00.000Z"),
      startedAt: STARTED,
      resolvedAt: RESOLVED,
    }),
  },
};
