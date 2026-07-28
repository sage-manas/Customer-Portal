import { buildDeliveryStages } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { DeliveryTracker } from "./DeliveryTracker";

/**
 * Every state comes from `buildDeliveryStages` rather than from hand-written
 * stage arrays — a story that fabricated its own stages could show a stepper
 * the application can never actually produce.
 */
const meta = {
  title: "Domain/DeliveryTracker",
  component: DeliveryTracker,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DeliveryTracker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotStarted: Story = {
  args: { stages: buildDeliveryStages({ status: "Open" }) },
};

export const Picked: Story = {
  args: { stages: buildDeliveryStages({ status: "Picked" }) },
};

export const Packed: Story = {
  args: { stages: buildDeliveryStages({ status: "Packed" }) },
};

export const InTransit: Story = {
  args: { stages: buildDeliveryStages({ status: "InTransit" }) },
};

export const Delivered: Story = {
  args: { stages: buildDeliveryStages({ status: "Delivered" }) },
};

/** The row variant, as the deliveries list draws it. */
export const Dense: Story = {
  args: { stages: buildDeliveryStages({ status: "InTransit" }), dense: true },
};
