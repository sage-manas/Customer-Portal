import type { Meta, StoryObj } from "@storybook/react";

import { Money } from "./Money";

const meta: Meta<typeof Money> = {
  title: "Domain/Money",
  component: Money,
};
export default meta;

type Story = StoryObj<typeof Money>;

export const Default: Story = { args: { value: 480000 } };
export const LakhCroreGrouping: Story = { args: { value: 12345678.5 } };
export const Debit: Story = { args: { value: 15000, tone: "debit" } };
export const Credit: Story = { args: { value: 15000, tone: "credit" } };
export const WithoutSymbol: Story = { args: { value: 15000, showSymbol: false } };
