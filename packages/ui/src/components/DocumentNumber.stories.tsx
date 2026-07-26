import type { Meta, StoryObj } from "@storybook/react";

import { DocumentNumber } from "./DocumentNumber";

const meta: Meta<typeof DocumentNumber> = {
  title: "Domain/DocumentNumber",
  component: DocumentNumber,
};
export default meta;

type Story = StoryObj<typeof DocumentNumber>;

export const SalesOrder: Story = { args: { value: "SO-2025-1841", href: "/orders/SO-2025-1841" } };
export const Invoice: Story = { args: { value: "INV-9002341", href: "/invoices/INV-9002341" } };
export const WithoutLink: Story = { args: { value: "DEL-4471200" } };
