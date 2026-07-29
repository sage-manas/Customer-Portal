import { creditPosition } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { CreditGauge } from "./CreditGauge";

/**
 * Every state is built by `creditPosition` from a KNKK-shaped read rather than
 * from a hand-written `CreditPosition` — a story that fabricated one could show
 * a gauge the application can never produce (a "healthy" account at 99%, say),
 * and the band thresholds would then be documented wrongly by the very stories
 * meant to demonstrate them.
 */
const position = (over: { creditLimit: number; utilized: number; blocked?: boolean }) =>
  creditPosition(
    {
      kunnr: "0010001001",
      creditLimit: over.creditLimit,
      utilized: over.utilized,
      available: over.creditLimit - over.utilized,
      blocked: over.blocked ?? false,
      currency: "INR",
    },
    { dso: 34 },
  );

const meta = {
  title: "Domain/CreditGauge",
  component: CreditGauge,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CreditGauge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Comfortable headroom — the everyday state. */
export const Healthy: Story = {
  args: { position: position({ creditLimit: 5_000_000, utilized: 1_842_500 }) },
};

/** Past 80% — docs/05 §7.9's amber. */
export const HighUtilisation: Story = {
  args: { position: position({ creditLimit: 5_000_000, utilized: 4_200_000 }) },
};

/** Past 95%: "orders may be blocked". */
export const NearLimit: Story = {
  args: { position: position({ creditLimit: 2_000_000, utilized: 1_965_000 }) },
};

/**
 * CTLPC set. The dial is red at 40% because the block, not the number, is what
 * decides — a green arc beside a small "blocked" chip misleads at a glance.
 */
export const OnCreditHold: Story = {
  args: { position: position({ creditLimit: 750_000, utilized: 300_000, blocked: true }) },
};

/** Over the limit: the arc caps at full while the figure stays honest. */
export const OverLimit: Story = {
  args: { position: position({ creditLimit: 750_000, utilized: 812_000, blocked: true }) },
};

/**
 * An account SAP has no limit for — prepayment terms, or a customer created
 * before FD32 was maintained. Not full utilisation, and no warning.
 */
export const NoLimitSet: Story = {
  args: { position: position({ creditLimit: 0, utilized: 0 }) },
};

/** No billing in the DSO window, so there is no DSO to report. */
export const WithoutDso: Story = {
  args: {
    position: creditPosition(
      {
        kunnr: "0010001001",
        creditLimit: 5_000_000,
        utilized: 1_842_500,
        available: 3_157_500,
        blocked: false,
        currency: "INR",
      },
      { dso: null },
    ),
  },
};

/** The dashboard tile: arc and headline, no figures. */
export const Compact: Story = {
  args: { position: position({ creditLimit: 5_000_000, utilized: 4_200_000 }), compact: true },
};
