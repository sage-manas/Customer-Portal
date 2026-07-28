import type { AgingSummary, OpenItem } from "@cc/domain";
import { buildAging } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { AmountAging, AmountAgingSkeleton } from "./AmountAging";

/**
 * Every story builds its summary with `buildAging()` from real open items
 * rather than hand-writing bucket objects — the same rule the O2CTimeline
 * stories follow (ADR-015). A story that fabricated its own buckets could
 * show a state the domain can never produce.
 */
const meta: Meta<typeof AmountAging> = {
  title: "Domain/AmountAging",
  component: AmountAging,
};
export default meta;

type Story = StoryObj<typeof AmountAging>;

const TODAY = "2026-07-28";

function item(documentNumber: string, dueDate: string, openAmount: number): OpenItem {
  return {
    documentNumber,
    documentType: "RV",
    postingDate: "2026-01-01",
    dueDate,
    amount: openAmount,
    openAmount,
    currency: "INR",
    status: openAmount > 0 ? "Open" : "Cleared",
  };
}

const healthy: AgingSummary = buildAging(
  [item("1", "2026-08-20", 687871.56), item("2", "2026-08-05", 143252)],
  TODAY,
);

const mixed: AgingSummary = buildAging(
  [
    item("1", "2026-08-20", 687871.56),
    item("2", "2026-06-20", 143252),
    item("3", "2026-05-10", 87910),
    item("4", "2026-01-15", 214300),
  ],
  TODAY,
);

const distressed: AgingSummary = buildAging(
  [item("1", "2026-02-01", 512000), item("2", "2025-11-20", 890400)],
  TODAY,
);

/** Everything within terms — the bar is entirely green and says so. */
export const NothingOverdue: Story = { args: { aging: healthy } };

/** The usual case: some current, some aging, a little very old. */
export const Mixed: Story = { args: { aging: mixed } };

/** Everything past 90 days — the state the credit team acts on. */
export const Distressed: Story = { args: { aging: distressed } };

/** A settled account. The rail stays, so the layout doesn't jump. */
export const Empty: Story = { args: { aging: buildAging([], TODAY) } };

/** Dashboard tile form: the bar and a legend, no table. */
export const Compact: Story = { args: { aging: mixed, compact: true } };

/** The AR summary drills into a bucket (docs/05 §7.10). */
export const Drillable: Story = {
  args: {
    aging: mixed,
    onSelectBucket: (key) => window.alert(`Drill into ${key}`),
  },
};

export const Loading: StoryObj = { render: () => <AmountAgingSkeleton /> };

export const AllStates: StoryObj = {
  render: () => (
    <div className="grid gap-6 md:grid-cols-2">
      <AmountAging aging={healthy} />
      <AmountAging aging={mixed} />
      <AmountAging aging={distressed} />
      <AmountAging aging={buildAging([], TODAY)} />
    </div>
  ),
};
