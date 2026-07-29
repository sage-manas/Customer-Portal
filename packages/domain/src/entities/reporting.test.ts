import { describe, expect, it } from "vitest";

import {
  aovTrend,
  isReportPeriodKey,
  isReportableOrder,
  monthLabel,
  monthsInRange,
  onTimeDelivery,
  ordersByMonth,
  purchaseTotal,
  REPORT_CACHE_TTL_SECONDS,
  reportRange,
  salesKpis,
  topProducts,
} from "./reporting";
import type { Delivery, Invoice, OrderStatusView, SalesDocLine } from "./sales-doc";

const TODAY = "2026-07-29";

function line(overrides: Partial<SalesDocLine> = {}): SalesDocLine {
  return {
    lineNo: 10,
    material: "MAT-1",
    description: "Widget",
    quantity: 10,
    uom: "EA",
    netPrice: 100,
    netValue: 1000,
    ...overrides,
  };
}

function order(overrides: Partial<OrderStatusView> = {}): OrderStatusView {
  return {
    vbeln: "0080000001",
    kunnr: "0010001001",
    createdOn: TODAY,
    orderStatus: "Open",
    creditStatus: "Approved",
    lines: [line()],
    netValue: 1000,
    currency: "INR",
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    vbeln: "0090000001",
    billingDate: TODAY,
    kunnr: "0010001001",
    billingType: "F2",
    taxableAmount: 1000,
    cgst: 90,
    sgst: 90,
    igst: 0,
    grossAmount: 1180,
    currency: "INR",
    dueDate: "2026-08-28",
    status: "Open",
    ...overrides,
  };
}

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    vbeln: "0070000001",
    salesOrder: "0080000001",
    kunnr: "0010001001",
    status: "Delivered",
    lines: [],
    ...overrides,
  };
}

describe("reportRange", () => {
  it("includes the current month in a months-back window", () => {
    // 3 months ending 29-Jul-26 is May, June, July — not April.
    expect(reportRange("last-3-months", TODAY)).toMatchObject({
      from: "2026-05-01",
      to: TODAY,
    });
  });

  it("ends today rather than at the end of the current month", () => {
    // A last bar covering a month that hasn't happened reads as a collapse.
    expect(reportRange("last-12-months", TODAY).to).toBe(TODAY);
    expect(reportRange("last-12-months", TODAY).from).toBe("2025-08-01");
  });

  it("resolves the fiscal year to April–today, and labels it", () => {
    const range = reportRange("fiscal-year", TODAY);
    expect(range.from).toBe("2026-04-01");
    expect(range.to).toBe(TODAY);
    expect(range.label).toBe("FY 2026-27");
  });

  it("ends a finished fiscal year on 31 March, not on today", () => {
    const range = reportRange("fiscal-year", "2026-03-15");
    expect(range.from).toBe("2025-04-01");
    expect(range.to).toBe("2026-03-15");
  });

  it("falls back to the fiscal year for an unknown key", () => {
    expect(reportRange("nonsense" as never, TODAY).key).toBe("fiscal-year");
    expect(isReportPeriodKey("nonsense")).toBe(false);
    expect(isReportPeriodKey("last-6-months")).toBe(true);
  });
});

describe("monthsInRange", () => {
  it("returns every month inclusive, across a year boundary", () => {
    const months = monthsInRange(reportRange("last-3-months", "2026-01-10"));
    expect(months).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("returns a single month when the range sits inside one", () => {
    expect(
      monthsInRange({ key: "fiscal-year", from: "2026-07-01", to: "2026-07-29", label: "" }),
    ).toEqual(["2026-07"]);
  });
});

describe("monthLabel", () => {
  it("prints the docs/05 §11 short form", () => {
    expect(monthLabel("2026-04")).toBe("Apr 26");
  });
});

describe("ordersByMonth", () => {
  const range = reportRange("last-3-months", TODAY);

  it("zero-fills months with no orders, because the gap is the finding", () => {
    const buckets = ordersByMonth([order({ createdOn: "2026-07-02" })], range);
    expect(buckets.map((b) => b.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(buckets[0]).toMatchObject({ orderCount: 0, value: 0, averageOrderValue: 0 });
    expect(buckets[2]).toMatchObject({ orderCount: 1, value: 1000, averageOrderValue: 1000 });
  });

  it("excludes a fully rejected order, so cancelling cannot raise the chart", () => {
    const buckets = ordersByMonth(
      [
        order({ vbeln: "A", createdOn: "2026-07-02" }),
        order({ vbeln: "B", createdOn: "2026-07-03", orderStatus: "Rejected", netValue: 99999 }),
      ],
      range,
    );
    expect(buckets[2]).toMatchObject({ orderCount: 1, value: 1000 });
    expect(isReportableOrder({ orderStatus: "Rejected" })).toBe(false);
  });

  it("ignores orders outside the range", () => {
    const buckets = ordersByMonth([order({ createdOn: "2026-01-05" })], range);
    expect(buckets.every((b) => b.orderCount === 0)).toBe(true);
  });

  it("averages within the month", () => {
    const buckets = ordersByMonth(
      [
        order({ vbeln: "A", createdOn: "2026-06-02", netValue: 1000 }),
        order({ vbeln: "B", createdOn: "2026-06-20", netValue: 3000 }),
      ],
      range,
    );
    expect(buckets[1]).toMatchObject({ orderCount: 2, value: 4000, averageOrderValue: 2000 });
  });

  it("gives the AOV chart the same buckets, so the two cannot disagree", () => {
    const buckets = ordersByMonth([order({ createdOn: "2026-07-02" })], range);
    expect(aovTrend(buckets).map((b) => b.key)).toEqual(buckets.map((b) => b.key));
  });
});

describe("topProducts", () => {
  const range = reportRange("last-12-months", TODAY);

  it("groups lines by material across orders and ranks by value", () => {
    const rows = topProducts(
      [
        order({
          vbeln: "A",
          lines: [
            line({ material: "MAT-1", quantity: 5, netValue: 500 }),
            line({ lineNo: 20, material: "MAT-2", quantity: 1, netValue: 4000 }),
          ],
        }),
        order({
          vbeln: "B",
          lines: [line({ material: "MAT-1", quantity: 5, netValue: 500 })],
        }),
      ],
      range,
    );

    expect(rows.map((r) => r.material)).toEqual(["MAT-2", "MAT-1"]);
    expect(rows[1]).toMatchObject({ quantity: 10, value: 1000, orderCount: 2 });
  });

  it("counts an order once even when it has two lines of the same material", () => {
    const rows = topProducts(
      [
        order({
          vbeln: "A",
          lines: [
            line({ material: "MAT-1", netValue: 100 }),
            line({ lineNo: 20, material: "MAT-1", netValue: 100 }),
          ],
        }),
      ],
      range,
    );
    expect(rows[0]).toMatchObject({ orderCount: 1, value: 200 });
  });

  it("honours the limit", () => {
    const orders = Array.from({ length: 15 }, (_, index) =>
      order({
        vbeln: `O${String(index)}`,
        lines: [line({ material: `MAT-${String(index)}`, netValue: index })],
      }),
    );
    expect(topProducts(orders, range, 5)).toHaveLength(5);
  });

  it("excludes rejected orders, like the month chart", () => {
    expect(topProducts([order({ orderStatus: "Rejected" })], range)).toEqual([]);
  });
});

describe("onTimeDelivery", () => {
  const range = reportRange("last-12-months", TODAY);

  it("scores actual against planned goods issue", () => {
    const result = onTimeDelivery(
      [
        delivery({ vbeln: "A", plannedGoodsIssue: "2026-07-01", actualGoodsIssue: "2026-07-01" }),
        delivery({ vbeln: "B", plannedGoodsIssue: "2026-07-01", actualGoodsIssue: "2026-06-30" }),
        delivery({ vbeln: "C", plannedGoodsIssue: "2026-07-01", actualGoodsIssue: "2026-07-05" }),
      ],
      range,
    );
    expect(result).toMatchObject({ shipped: 3, onTime: 2, late: 1, ratePercent: 66.7 });
  });

  it("does not count an unshipped delivery as late", () => {
    const result = onTimeDelivery(
      [delivery({ plannedGoodsIssue: "2026-07-25", status: "InProcess" })],
      range,
    );
    expect(result).toMatchObject({ shipped: 0, late: 0, pending: 1, ratePercent: null });
  });

  it("reports a shipped delivery with no planned date apart, not as on time", () => {
    // Otherwise OTD rises by not planning.
    const result = onTimeDelivery([delivery({ actualGoodsIssue: "2026-07-01" })], range);
    expect(result).toMatchObject({ shipped: 0, onTime: 0, unmeasured: 1, ratePercent: null });
  });

  it("ignores shipments outside the range", () => {
    const result = onTimeDelivery(
      [delivery({ plannedGoodsIssue: "2024-01-01", actualGoodsIssue: "2024-01-01" })],
      range,
    );
    expect(result.shipped).toBe(0);
  });
});

describe("purchaseTotal", () => {
  it("sums the taxable amount, so it reconciles with the loyalty ladder", () => {
    expect(purchaseTotal([invoice({ taxableAmount: 1000 })], "2026-04-01", "2027-03-31")).toBe(
      1000,
    );
  });

  it("lets a credit note reduce the total by arithmetic (ADR-020)", () => {
    const total = purchaseTotal(
      [
        invoice({ vbeln: "A", taxableAmount: 1000 }),
        invoice({ vbeln: "B", billingType: "G2", taxableAmount: -250 }),
      ],
      "2026-04-01",
      "2027-03-31",
    );
    expect(total).toBe(750);
  });

  it("excludes invoices outside the window", () => {
    expect(
      purchaseTotal([invoice({ billingDate: "2025-01-01" })], "2026-04-01", "2027-03-31"),
    ).toBe(0);
  });
});

describe("salesKpis", () => {
  it("answers YTD and period separately, because they are different questions", () => {
    const range = reportRange("last-3-months", TODAY);
    const kpis = salesKpis({
      orders: [
        order({ vbeln: "A", createdOn: "2026-07-01", netValue: 1000 }),
        order({ vbeln: "B", createdOn: "2026-02-01", netValue: 5000, orderStatus: "Closed" }),
      ],
      invoices: [
        invoice({ vbeln: "I1", billingDate: "2026-05-01", taxableAmount: 4000, status: "Paid" }),
        invoice({ vbeln: "I2", billingDate: "2026-02-01", taxableAmount: 9000, status: "Paid" }),
      ],
      deliveries: [],
      range,
      today: TODAY,
    });

    // FY 2026-27 started 1 April, so the February invoice is last year's.
    expect(kpis.ytdPurchases).toBe(4000);
    expect(kpis.fiscalYear.label).toBe("FY 2026-27");
    expect(kpis.periodValue).toBe(1000);
    expect(kpis.periodOrderCount).toBe(1);
    expect(kpis.averageOrderValue).toBe(1000);
  });

  it("counts open orders regardless of the selected period", () => {
    // Narrowing the chart is not a request to change the account position —
    // ADR-018's rule for the aging bar, applied to the KPI row.
    const kpis = salesKpis({
      orders: [order({ createdOn: "2025-01-01", orderStatus: "Confirmed", netValue: 700 })],
      invoices: [],
      deliveries: [],
      range: reportRange("last-3-months", TODAY),
      today: TODAY,
    });
    expect(kpis.openOrders).toEqual({ count: 1, value: 700 });
    expect(kpis.periodOrderCount).toBe(0);
  });

  it("counts only open and overdue invoices as pending, at gross", () => {
    const kpis = salesKpis({
      orders: [],
      invoices: [
        invoice({ vbeln: "A", status: "Open", grossAmount: 1180 }),
        invoice({ vbeln: "B", status: "Overdue", grossAmount: 500 }),
        invoice({ vbeln: "C", status: "Paid", grossAmount: 9999 }),
      ],
      deliveries: [],
      range: reportRange("last-12-months", TODAY),
      today: TODAY,
    });
    expect(kpis.pendingInvoices).toEqual({ count: 2, value: 1680 });
  });
});

describe("REPORT_CACHE_TTL_SECONDS", () => {
  it("keeps the AR summary fresher than the sales trend", () => {
    // The AR screen is read while deciding what to pay; a trend is not.
    expect(REPORT_CACHE_TTL_SECONDS["reports.ar"]).toBeLessThan(
      REPORT_CACHE_TTL_SECONDS["reports.sales"],
    );
  });
});
