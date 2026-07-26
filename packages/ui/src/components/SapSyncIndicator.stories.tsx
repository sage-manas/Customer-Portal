import type { Meta, StoryObj } from "@storybook/react";

import { SapSyncIndicator, StaleDataBanner } from "./SapSyncIndicator";

const meta: Meta<typeof SapSyncIndicator> = {
  title: "Domain/SapSyncIndicator",
  component: SapSyncIndicator,
};
export default meta;

type Story = StoryObj<typeof SapSyncIndicator>;

const NOW = new Date("2026-07-26T10:00:00.000Z");

export const Live: Story = { args: { state: "live" } };

export const Cached: Story = {
  args: { state: "cached", syncedAt: "2026-07-26T09:55:00.000Z", now: NOW },
};

export const Stale: Story = { args: { state: "stale" } };

export const PendingWrite: Story = { args: { state: "pending" } };

export const AllStates: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SapSyncIndicator state="live" />
      <SapSyncIndicator state="cached" syncedAt="2026-07-26T09:42:00.000Z" now={NOW} />
      <SapSyncIndicator state="stale" />
      <SapSyncIndicator state="pending" />
    </div>
  ),
};

export const OutageBanner: StoryObj = {
  render: () => <StaleDataBanner syncedAt="2026-07-26T09:42:00.000Z" onRetry={() => undefined} />,
};
