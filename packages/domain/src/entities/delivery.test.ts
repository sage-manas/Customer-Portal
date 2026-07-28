import { describe, expect, it } from "vitest";

import { mapDeliveryWbstkToStatus } from "../status";

import {
  buildDeliveryStages,
  describePodDiscrepancy,
  ewayBillExpected,
  isPodConfirmable,
  podConfirmSchema,
  podDefaultLines,
  podDiscrepancy,
  podReceiptDateIssue,
} from "./delivery";
import type { SalesDocLine } from "./sales-doc";

const line = (over: Partial<SalesDocLine> = {}): SalesDocLine => ({
  lineNo: 10,
  material: "MAT-10001",
  quantity: 12,
  uom: "EA",
  netPrice: 100,
  netValue: 1200,
  ...over,
});

describe("buildDeliveryStages", () => {
  it("marks everything up to the current stage as reached", () => {
    const stages = buildDeliveryStages({ status: "Packed" });

    expect(stages.map((s) => s.reached)).toEqual([true, true, true, false, false]);
    expect(stages.find((s) => s.current)?.key).toBe("packed");
  });

  it("places a status the stepper doesn't model at the start rather than throwing", () => {
    const stages = buildDeliveryStages({ status: "Open" });

    expect(stages.find((s) => s.current)?.key).toBe("notStarted");
    expect(stages.filter((s) => s.reached)).toHaveLength(1);
  });

  it("reaches every stage once delivered", () => {
    expect(buildDeliveryStages({ status: "Delivered" }).every((s) => s.reached)).toBe(true);
  });
});

describe("mapDeliveryWbstkToStatus", () => {
  it("uses PGI events to tell the pre-dispatch stages apart", () => {
    expect(mapDeliveryWbstkToStatus("A")).toBe("Open");
    expect(mapDeliveryWbstkToStatus("A", { picked: true })).toBe("Picked");
    expect(mapDeliveryWbstkToStatus("A", { picked: true, packed: true })).toBe("Packed");
    expect(mapDeliveryWbstkToStatus("A", { packed: true, goodsIssued: true })).toBe("InTransit");
  });

  it("lets WBSTK win once goods have moved", () => {
    expect(mapDeliveryWbstkToStatus("B")).toBe("PartiallyDelivered");
    expect(mapDeliveryWbstkToStatus("C", { picked: true })).toBe("Delivered");
  });
});

describe("podDiscrepancy", () => {
  const dispatched = [
    line(),
    line({ lineNo: 20, material: "MAT-30001", quantity: 90, uom: "SET" }),
  ];

  it("finds no discrepancy when the defaults are confirmed unchanged", () => {
    const result = podDiscrepancy(dispatched, podDefaultLines(dispatched));

    expect(result.hasDiscrepancy).toBe(false);
    expect(result.differences).toHaveLength(0);
  });

  it("treats an omitted line as fully received, not as zero", () => {
    // The form pre-fills dispatched quantities, so a line the customer never
    // touched must not raise a discrepancy against them.
    const result = podDiscrepancy(dispatched, [{ lineNo: 10, receivedQty: 12 }]);

    expect(result.hasDiscrepancy).toBe(false);
    expect(result.lines.find((l) => l.lineNo === 20)?.receivedQty).toBe(90);
  });

  it("flags a short receipt with its shortfall", () => {
    const result = podDiscrepancy(dispatched, [
      { lineNo: 10, receivedQty: 9 },
      { lineNo: 20, receivedQty: 90 },
    ]);

    expect(result.hasDiscrepancy).toBe(true);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({ lineNo: 10, difference: -3, short: true });
  });

  it("flags an over-receipt too — the paperwork still doesn't match", () => {
    const result = podDiscrepancy(dispatched, [{ lineNo: 10, receivedQty: 13 }]);

    expect(result.hasDiscrepancy).toBe(true);
    expect(result.differences[0]).toMatchObject({ difference: 1, short: false });
  });

  it("describes the differences in the customer's units", () => {
    const result = podDiscrepancy(dispatched, [{ lineNo: 20, receivedQty: 85 }]);

    expect(describePodDiscrepancy(result)).toBe("MAT-30001: received 85 SET of 90 dispatched");
  });

  it("does not report a phantom difference from float subtraction", () => {
    const result = podDiscrepancy(
      [line({ quantity: 0.3 })],
      [{ lineNo: 10, receivedQty: 0.1 + 0.2 }],
    );

    expect(result.hasDiscrepancy).toBe(false);
  });
});

describe("isPodConfirmable", () => {
  it("refuses a shipment that hasn't left the warehouse", () => {
    expect(isPodConfirmable({ status: "Picked" })).toBe(false);
    expect(isPodConfirmable({ status: "Packed" })).toBe(false);
  });

  it("allows one in transit or already marked delivered", () => {
    expect(isPodConfirmable({ status: "InTransit" })).toBe(true);
    expect(isPodConfirmable({ status: "Delivered" })).toBe(true);
  });

  it("refuses one the customer has already signed for", () => {
    expect(isPodConfirmable({ status: "Delivered", podConfirmed: true })).toBe(false);
  });
});

describe("podReceiptDateIssue", () => {
  const delivery = { actualGoodsIssue: "2026-07-20" };

  it("accepts a date between dispatch and today", () => {
    expect(podReceiptDateIssue("2026-07-22", delivery, "2026-07-28")).toBeNull();
  });

  it("rejects a future date", () => {
    expect(podReceiptDateIssue("2026-07-29", delivery, "2026-07-28")).toMatch(/future/);
  });

  it("rejects a date before the goods were dispatched", () => {
    expect(podReceiptDateIssue("2026-07-19", delivery, "2026-07-28")).toMatch(/dispatched/);
  });

  it("has no lower bound when the delivery has no goods-issue date", () => {
    expect(podReceiptDateIssue("2020-01-01", {}, "2026-07-28")).toBeNull();
  });
});

describe("podConfirmSchema", () => {
  it("rejects a negative received quantity", () => {
    const result = podConfirmSchema.safeParse({
      receiptDate: "2026-07-22",
      lines: [{ lineNo: 10, receivedQty: -1 }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a receipt with no lines at all", () => {
    expect(podConfirmSchema.safeParse({ receiptDate: "2026-07-22", lines: [] }).success).toBe(
      false,
    );
  });

  it("rejects a non-ISO receipt date", () => {
    expect(
      podConfirmSchema.safeParse({
        receiptDate: "22/07/2026",
        lines: [{ lineNo: 10, receivedQty: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("ewayBillExpected", () => {
  it("is the statutory Rs 50,000 threshold, exclusive", () => {
    expect(ewayBillExpected(50_000)).toBe(false);
    expect(ewayBillExpected(50_000.01)).toBe(true);
  });
});
