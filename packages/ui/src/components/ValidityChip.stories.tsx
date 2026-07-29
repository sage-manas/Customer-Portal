import { quotationValidity } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { ValidityChip } from "./ValidityChip";

/**
 * Every state comes from `quotationValidity` rather than a hand-written object
 * — a story that fabricated one could show a chip the application can never
 * produce (an "expired" quotation with days left on it, say).
 *
 * `now` is pinned so the relative time in each chip is stable across runs.
 */
const NOW = new Date("2026-07-29T12:00:00.000Z");

const meta = {
  title: "Domain/ValidityChip",
  component: ValidityChip,
  parameters: { layout: "centered" },
  args: { now: NOW },
} satisfies Meta<typeof ValidityChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three weeks of validity left — nothing for the customer to hurry about. */
export const Valid: Story = {
  args: { validity: quotationValidity("2026-08-19", NOW) },
};

/** Inside the 72-hour window: the amber chip of docs/05 §7.3. */
export const Expiring: Story = {
  args: { validity: quotationValidity("2026-07-31", NOW) },
};

/**
 * BNDDT is inclusive, so a quotation valid *until today* is still acceptable
 * today — it shows as expiring, never as expired.
 */
export const LastDay: Story = {
  args: { validity: quotationValidity("2026-07-29", NOW) },
};

/** Lapsed. Accept is refused; "Request revalidation" is what's left. */
export const Expired: Story = {
  args: { validity: quotationValidity("2026-07-14", NOW) },
};

/** The table-row variant, which drops the word and keeps the time. */
export const Dense: Story = {
  args: { validity: quotationValidity("2026-07-31", NOW), dense: true },
};
