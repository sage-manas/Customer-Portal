import type { Meta, StoryObj } from "@storybook/react";

import { DecisionGate } from "./DecisionGate";

const meta: Meta<typeof DecisionGate> = {
  title: "Domain/DecisionGate",
  component: DecisionGate,
};
export default meta;

type Story = StoryObj<typeof DecisionGate>;

export const AllPassed: Story = {
  args: {
    title: "System checks",
    items: [
      {
        label: "GSTIN verified with GSTN",
        passed: true,
        detail: "Vertex Polymers Private Limited · Active",
      },
      { label: "PAN matches the GSTIN", passed: true },
      { label: "GST state matches billing state", passed: true, detail: "27 — Maharashtra" },
      { label: "Mandatory documents uploaded", passed: true, detail: "PAN card, GST certificate" },
      { label: "No duplicate registration", passed: true },
    ],
  },
};

export const SomeFailed: Story = {
  args: {
    title: "System checks",
    items: [
      {
        label: "GSTIN verified with GSTN",
        passed: false,
        detail: "GSTN reports this registration as cancelled.",
      },
      { label: "PAN matches the GSTIN", passed: true },
      {
        label: "GST state matches billing state",
        passed: false,
        detail: "GSTIN state 29 — Karnataka, billing state 27 — Maharashtra",
      },
      { label: "Mandatory documents uploaded", passed: true },
    ],
  },
};
