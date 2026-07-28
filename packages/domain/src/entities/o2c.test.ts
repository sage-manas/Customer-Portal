import { describe, expect, it } from "vitest";

import { buildO2CTimeline, O2C_STAGES } from "./o2c";
import type { Delivery, Invoice, OrderStatusView } from "./sales-doc";

/**
 * The timeline is the product's central claim about a document ("status is a
 * spine"), so what it says when a stage has *not* happened matters as much
 * as what it says when it has.
 */

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

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  vbeln: "0080001947",
  salesOrder: order.vbeln,
  status: "InTransit",
  plannedGoodsIssue: "2026-07-24",
  actualGoodsIssue: "2026-07-24",
  lines: [],
  ...over,
});

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  vbeln: "0090002211",
  billingDate: "2026-07-25",
  kunnr: order.kunnr,
  taxableAmount: 100,
  cgst: 9,
  sgst: 9,
  igst: 0,
  grossAmount: 118,
  currency: "INR",
  dueDate: "2026-08-24",
  status: "Open",
  ...over,
});

const stageBy = (stages: ReturnType<typeof buildO2CTimeline>, key: string) =>
  stages.find((s) => s.key === key)!;

describe("buildO2CTimeline", () => {
  it("always returns the five registry stages, in order", () => {
    const stages = buildO2CTimeline({ order });
    expect(stages.map((s) => s.key)).toEqual(O2C_STAGES.map((s) => s.key));
  });

  it("leaves unreached stages null rather than calling them open", () => {
    const stages = buildO2CTimeline({ order });

    expect(stageBy(stages, "order").status).toBe("Open");
    expect(stageBy(stages, "delivery").status).toBeNull();
    expect(stageBy(stages, "invoice").status).toBeNull();
    expect(stageBy(stages, "payment").status).toBeNull();
  });

  it("stops at the credit gate when the order is blocked", () => {
    const stages = buildO2CTimeline({ order: { ...order, creditStatus: "CreditHold" } });

    const credit = stageBy(stages, "creditCheck");
    expect(credit.status).toBe("CreditHold");
    expect(credit.note).toContain("credit team");
  });

  it("is only 'delivered' once every delivery is", () => {
    const partly = buildO2CTimeline({
      order,
      deliveries: [delivery({ status: "Delivered" }), delivery({ vbeln: "0080001948" })],
    });
    expect(stageBy(partly, "delivery").status).toBe("PartiallyDelivered");

    const fully = buildO2CTimeline({
      order,
      deliveries: [
        delivery({ status: "Delivered" }),
        delivery({ vbeln: "x", status: "Delivered" }),
      ],
    });
    expect(stageBy(fully, "delivery").status).toBe("Delivered");
  });

  it("links every document it reports", () => {
    const stages = buildO2CTimeline({ order, deliveries: [delivery()], invoices: [invoice()] });

    expect(stageBy(stages, "order").documents[0]).toEqual({
      value: "0000004712",
      href: "/orders/0000004712",
    });
    expect(stageBy(stages, "delivery").documents[0]!.href).toBe("/deliveries/0080001947");
    expect(stageBy(stages, "invoice").documents[0]!.href).toBe("/invoices/0090002211");
  });

  it("reads payment off the invoices: overdue wins over open, paid needs all", () => {
    expect(
      stageBy(buildO2CTimeline({ order, invoices: [invoice({ status: "Overdue" })] }), "payment")
        .status,
    ).toBe("Overdue");

    expect(
      stageBy(
        buildO2CTimeline({
          order,
          invoices: [invoice({ status: "Paid" }), invoice({ vbeln: "b" })],
        }),
        "payment",
      ).status,
    ).toBe("Open");

    expect(
      stageBy(
        buildO2CTimeline({
          order,
          invoices: [invoice({ status: "Paid" }), invoice({ vbeln: "b", status: "Cleared" })],
        }),
        "payment",
      ).status,
    ).toBe("Paid");
  });

  it("says why a cancelled order ended where it did", () => {
    const stages = buildO2CTimeline({
      order: { ...order, orderStatus: "Closed", rejectionReason: "Ordered in error" },
    });
    expect(stageBy(stages, "order").note).toContain("Ordered in error");
  });
});
