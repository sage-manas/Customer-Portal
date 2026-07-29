import { loyaltyStanding, resolveTierThresholds } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { TierProgress } from "./TierProgress";

/**
 * Each standing is computed by `loyaltyStanding` from a purchase figure, not
 * hand-written — so a story cannot show a Gold customer whose progress bar
 * disagrees with the tenant's ladder, which is the exact bug the component
 * exists to make impossible.
 */
const meta = {
  title: "Domain/TierProgress",
  component: TierProgress,
  parameters: { layout: "padded" },
  args: { fiscalYearLabel: "FY 2026-27" },
} satisfies Meta<typeof TierProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new account, at the entry tier with nothing bought yet. */
export const Bronze: Story = {
  args: { standing: loyaltyStanding(0) },
};

/** The seeded demo account: past Silver, over halfway to Gold. */
export const Silver: Story = {
  args: { standing: loyaltyStanding(6_901_702) },
};

export const Gold: Story = {
  args: { standing: loyaltyStanding(14_500_000) },
};

/** Top of the ladder: the bar is full because there is nothing above it. */
export const Platinum: Story = {
  args: { standing: loyaltyStanding(31_000_000) },
};

/**
 * The same purchases against a tenant that set its own thresholds. Nothing
 * about the customer changed — only the ladder they are measured on.
 */
export const OnATenantsOwnLadder: Story = {
  args: {
    standing: loyaltyStanding(
      6_901_702,
      resolveTierThresholds({ silver: 500_000, gold: 1_000_000, platinum: 5_000_000 }),
    ),
  },
};

/** The dashboard hero band: chip and bar, no blurb. */
export const Compact: Story = {
  args: { standing: loyaltyStanding(6_901_702), compact: true },
};
