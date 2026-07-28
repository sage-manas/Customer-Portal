import { describe, expect, it } from "vitest";

import {
  isOrderCancellable,
  salesOrderDraftSchema,
  salesOrderWriteSchema,
  toCreateSalesOrderInput,
} from "./order";

const validOrder = {
  requestedDeliveryDate: "2026-08-15",
  shipTo: "0010001001",
  customerPoRef: "PO-SH-9001",
  lines: [{ material: "MAT-10001", quantity: 2, uom: "EA" }],
};

describe("salesOrderWriteSchema", () => {
  it("derives its constraints from the SAP registry, not from hand-written rules", () => {
    // VBKD-BSTNK is CHAR 20.
    const tooLong = salesOrderWriteSchema.safeParse({
      ...validOrder,
      customerPoRef: "P".repeat(21),
    });
    expect(tooLong.success).toBe(false);

    // VBAK-VDATU is DATS.
    const badDate = salesOrderWriteSchema.safeParse({
      ...validOrder,
      requestedDeliveryDate: "15/08/2026",
    });
    expect(badDate.success).toBe(false);
  });

  it("requires a ship-to and a delivery date", () => {
    for (const field of ["shipTo", "requestedDeliveryDate"]) {
      const parsed = salesOrderWriteSchema.safeParse({ ...validOrder, [field]: "" });
      expect(parsed.success, field).toBe(false);
    }
  });

  it("refuses an order with no lines, and a line of zero", () => {
    expect(salesOrderWriteSchema.safeParse({ ...validOrder, lines: [] }).success).toBe(false);
    expect(
      salesOrderWriteSchema.safeParse({
        ...validOrder,
        lines: [{ material: "MAT-10001", quantity: 0, uom: "EA" }],
      }).success,
    ).toBe(false);
  });

  it("accepts a complete order", () => {
    expect(salesOrderWriteSchema.safeParse(validOrder).success).toBe(true);
  });
});

describe("salesOrderDraftSchema", () => {
  it("saves an incomplete order — a draft that must be complete is not a draft", () => {
    const parsed = salesOrderDraftSchema.safeParse({ lines: [] });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.lines).toEqual([]);
  });

  it("still holds a line to the rules SAP would apply to it", () => {
    expect(
      salesOrderDraftSchema.safeParse({ lines: [{ material: "", quantity: 1, uom: "EA" }] })
        .success,
    ).toBe(false);
  });
});

describe("toCreateSalesOrderInput", () => {
  it("stamps the sold-to from the caller and renames price to NETPR", () => {
    const input = toCreateSalesOrderInput("0010001001", {
      ...validOrder,
      lines: [{ material: "MAT-10001", quantity: 2, uom: "EA", price: 42437.5 }],
    });

    expect(input.kunnr).toBe("0010001001");
    expect(input.lines[0]).toEqual({
      material: "MAT-10001",
      quantity: 2,
      uom: "EA",
      netPrice: 42437.5,
    });
  });
});

describe("isOrderCancellable", () => {
  it("allows cancellation only while the order is fully open (GBSTK=A)", () => {
    expect(isOrderCancellable({ orderStatus: "Open" })).toBe(true);
    expect(isOrderCancellable({ orderStatus: "PartiallyDelivered" })).toBe(false);
    expect(isOrderCancellable({ orderStatus: "Closed" })).toBe(false);
  });
});
