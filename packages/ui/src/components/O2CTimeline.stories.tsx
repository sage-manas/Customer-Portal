import { buildO2CTimeline, type Delivery, type Invoice, type OrderStatusView } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { O2CTimeline } from "./O2CTimeline";

/**
 * Every state here is produced by `buildO2CTimeline` from realistic
 * documents rather than by hand-writing stage objects — a story that
 * assembled its own stages could show a combination the domain never
 * produces.
 */

const meta: Meta<typeof O2CTimeline> = {
  title: "Domain/O2CTimeline",
  component: O2CTimeline,
};
export default meta;

const order: OrderStatusView = {
  vbeln: "0000004712",
  kunnr: "0010001001",
  createdOn: "2026-07-20",
  customerPoRef: "PO-SH-8902",
  orderStatus: "Open",
  creditStatus: "Confirmed",
  netValue: 236000,
  currency: "INR",
  lines: [],
};

const delivery: Delivery = {
  vbeln: "0080001947",
  salesOrder: order.vbeln,
  status: "InTransit",
  plannedGoodsIssue: "2026-07-24",
  actualGoodsIssue: "2026-07-24",
  carrier: "VRL",
  trackingNumber: "VRL7781209",
  lines: [],
};

const invoice: Invoice = {
  vbeln: "0090002211",
  billingDate: "2026-07-25",
  reference: delivery.vbeln,
  kunnr: order.kunnr,
  taxableAmount: 582942,
  cgst: 52464.78,
  sgst: 52464.78,
  igst: 0,
  grossAmount: 687871.56,
  currency: "INR",
  dueDate: "2026-08-24",
  status: "Open",
};

type Story = StoryObj<typeof O2CTimeline>;

/** Just created: everything past the credit gate is still to come. */
export const JustOrdered: Story = {
  args: { stages: buildO2CTimeline({ order }), currentStage: "order" },
};

/** The gate that stops the chain — doc 03 Module 4 flow. */
export const CreditBlocked: Story = {
  args: {
    stages: buildO2CTimeline({ order: { ...order, creditStatus: "CreditHold" } }),
    currentStage: "order",
  },
};

export const InTransit: Story = {
  args: { stages: buildO2CTimeline({ order, deliveries: [delivery] }), currentStage: "delivery" },
};

export const Invoiced: Story = {
  args: {
    stages: buildO2CTimeline({ order, deliveries: [delivery], invoices: [invoice] }),
    currentStage: "invoice",
  },
};

export const Overdue: Story = {
  args: {
    stages: buildO2CTimeline({
      order,
      deliveries: [{ ...delivery, status: "Delivered" }],
      invoices: [{ ...invoice, status: "Overdue" }],
    }),
    currentStage: "payment",
  },
};

/** The whole chain settled. */
export const Complete: Story = {
  args: {
    stages: buildO2CTimeline({
      order: { ...order, orderStatus: "Closed" },
      deliveries: [{ ...delivery, status: "Delivered" }],
      invoices: [{ ...invoice, status: "Paid" }],
    }),
    currentStage: "payment",
  },
};

/** Cancelled before anything shipped: the note says why the chain stops. */
export const Cancelled: Story = {
  args: {
    stages: buildO2CTimeline({
      order: { ...order, orderStatus: "Closed", rejectionReason: "Ordered in error" },
    }),
    currentStage: "order",
  },
};
