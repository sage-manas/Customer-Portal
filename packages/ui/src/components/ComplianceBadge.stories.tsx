import type { Meta, StoryObj } from "@storybook/react";

import { ComplianceBadge } from "./ComplianceBadge";

const meta: Meta<typeof ComplianceBadge> = {
  title: "Domain/ComplianceBadge",
  component: ComplianceBadge,
};
export default meta;

type Story = StoryObj<typeof ComplianceBadge>;

export const GstinVerified: Story = {
  args: {
    kind: "gstin",
    value: "27AAPFU0939F1ZV",
    state: "verified",
    caption: "Vertex Polymers Private Limited",
  },
};

export const GstinUnverified: Story = {
  args: { kind: "gstin", value: "27AAPFU0939F1ZV", state: "unverified" },
};

export const GstinFailed: Story = {
  args: {
    kind: "gstin",
    value: "24AAACC1206D1ZM",
    state: "failed",
    caption: "GSTN reports this registration as cancelled.",
  },
};

export const Irn: Story = {
  args: {
    kind: "irn",
    value: "a5c1f0f0e0b64a2e9c1d7f3b8a2e4d6c9f1b3a5c7e9d1f3b5a7c9e1d3f5b7a9c",
    state: "verified",
    caption: "e-Invoice registered",
  },
};

export const EwayBill: Story = {
  args: { kind: "eway", value: "391004512345", state: "verified" },
};
