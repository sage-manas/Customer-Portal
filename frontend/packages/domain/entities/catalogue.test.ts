import { describe, expect, it } from "vitest";

import { LOW_STOCK_MOQ_MULTIPLE, stockAvailability, totalStock } from "./catalogue";

describe("stockAvailability", () => {
  it("is unknown when the quantity was never read", () => {
    expect(stockAvailability(null)).toBe("unknown");
    expect(stockAvailability(undefined)).toBe("unknown");
  });

  it("is out_of_stock at zero or below", () => {
    expect(stockAvailability(0)).toBe("out_of_stock");
    expect(stockAvailability(-1)).toBe("out_of_stock");
  });

  it("is relative to the minimum order quantity, not a flat number", () => {
    // 40 units is nearly nothing of a MOQ-50 item...
    expect(stockAvailability(40, 50)).toBe("low");
    // ...but plenty of a MOQ-1 item.
    expect(stockAvailability(40, 1)).toBe("in_stock");
  });

  it("treats an MOQ of exactly the low-stock multiple as still low", () => {
    const moq = 10;
    expect(stockAvailability(moq * LOW_STOCK_MOQ_MULTIPLE - 1, moq)).toBe("low");
    expect(stockAvailability(moq * LOW_STOCK_MOQ_MULTIPLE, moq)).toBe("in_stock");
  });

  it("treats a non-positive MOQ as 1 rather than dividing by zero", () => {
    expect(stockAvailability(3, 0)).toBe("in_stock");
    expect(stockAvailability(2, 0)).toBe("low");
  });
});

describe("totalStock", () => {
  it("sums quantity across plants", () => {
    expect(
      totalStock([
        { material: "MAT-1", plant: "1000", quantity: 5, uom: "EA" },
        { material: "MAT-1", plant: "2000", quantity: 3, uom: "EA" },
      ]),
    ).toBe(8);
  });

  it("is zero for no stock levels", () => {
    expect(totalStock([])).toBe(0);
  });
});
