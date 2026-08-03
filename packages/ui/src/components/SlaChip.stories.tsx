import { slaView } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { SlaChip } from "./SlaChip";

/**
 * Every state comes from `slaView` rather than from a hand-written `SlaView`
 * object — a story that fabricated one could show a chip the application can
 * never produce (a "met" SLA that is also overdue, say).
 *
 * `now` is pinned so the relative time in each chip is stable across runs.
 */
const NOW = new Date("2026-07-29T12:00:00.000Z");
const opened = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000);

const meta = {
  title: "Domain/SlaChip",
  component: SlaChip,
  parameters: { layout: "centered" },
  args: { now: NOW },
} satisfies Meta<typeof SlaChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Plenty of time left on a 24-hour medium SLA. */
export const WithinSla: Story = {
  args: { sla: slaView(opened(2), "medium", { now: NOW }) },
};

/** Under 25% of the window remaining — the amber chip of docs/05 §7.8. */
export const NearlyDue: Story = {
  args: { sla: slaView(opened(3.5), "critical", { now: NOW }) },
};

/** Past the deadline and still unresolved. */
export const Breached: Story = {
  args: { sla: slaView(opened(9), "high", { now: NOW }) },
};

/** Resolved inside the window. */
export const Met: Story = {
  args: { sla: slaView(opened(3), "high", { resolvedAt: opened(1), now: NOW }) },
};

/**
 * Resolved *after* the deadline. Still breached — a chip that flipped to
 * "met" once the work finished would make the SLA report measure nothing.
 */
export const ResolvedLate: Story = {
  args: { sla: slaView(opened(12), "high", { resolvedAt: opened(1), now: NOW }) },
};

/** The table-row variant, which drops the word and keeps the time. */
export const Dense: Story = {
  args: { sla: slaView(opened(9), "high", { now: NOW }), dense: true },
};
