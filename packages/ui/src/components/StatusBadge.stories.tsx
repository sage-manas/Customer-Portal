import { CANONICAL_STATUSES } from "@cc/domain/status";
import type { Meta, StoryObj } from "@storybook/react";

import { StatusBadge } from "./StatusBadge";

const meta: Meta<typeof StatusBadge> = {
  title: "Domain/StatusBadge",
  component: StatusBadge,
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Default: Story = { args: { status: "Confirmed" } };
export const CreditHold: Story = { args: { status: "CreditHold" } };
export const Overdue: Story = { args: { status: "Overdue" } };

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {CANONICAL_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
