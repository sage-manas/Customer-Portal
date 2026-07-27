import type { Meta, StoryObj } from "@storybook/react";

import { StockChip, StockChipSkeleton } from "./StockChip";

const meta: Meta<typeof StockChip> = {
  title: "Domain/StockChip",
  component: StockChip,
};
export default meta;

type Story = StoryObj<typeof StockChip>;

export const InStock: Story = { args: { availability: "in_stock", quantity: 620, uom: "EA" } };

/** "Low" is relative to the material's MOQ — see stockAvailability() in @cc/domain. */
export const Low: Story = { args: { availability: "low", quantity: 8, uom: "EA" } };

export const OutOfStock: Story = {
  args: { availability: "out_of_stock", quantity: 0, uom: "EA", leadTimeDays: 21 },
};

/** The stock read itself failed — the chip says so rather than showing zero. */
export const Unknown: Story = { args: { availability: "unknown" } };

export const Loading: StoryObj = { render: () => <StockChipSkeleton /> };

export const AllStates: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StockChip availability="in_stock" quantity={620} uom="EA" />
      <StockChip availability="low" quantity={8} uom="EA" />
      <StockChip availability="out_of_stock" quantity={0} uom="EA" leadTimeDays={21} />
      <StockChip availability="unknown" />
      <StockChipSkeleton />
    </div>
  ),
};
