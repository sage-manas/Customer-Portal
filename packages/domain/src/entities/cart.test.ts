import { describe, expect, it } from "vitest";

import { orderMapping } from "../sap-mapping/order";

import { cartLineWriteSchema, cartQuantitySchema } from "./cart";

describe("cartLineWriteSchema", () => {
  it("accepts a material and quantity", () => {
    const parsed = cartLineWriteSchema.parse({ material: "MAT-10001", quantity: "5" });
    expect(parsed).toEqual({ material: "MAT-10001", quantity: 5 });
  });

  it("rejects a zero or negative quantity — that is a removal, not a line", () => {
    expect(cartLineWriteSchema.safeParse({ material: "MAT-10001", quantity: 0 }).success).toBe(
      false,
    );
    expect(cartQuantitySchema.safeParse({ quantity: -2 }).success).toBe(false);
  });

  it("enforces MATNR's registry length rather than a hand-written one", () => {
    const matnr = orderMapping.find((f) => f.portalField === "material");
    const tooLong = "M".repeat((matnr?.length ?? 18) + 1);
    expect(cartLineWriteSchema.safeParse({ material: tooLong, quantity: 1 }).success).toBe(false);
  });

  it("does not accept a client-supplied UoM — that comes from the material master", () => {
    const parsed = cartLineWriteSchema.parse({
      material: "MAT-10001",
      quantity: 1,
      uom: "TONNE",
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("uom");
  });
});
