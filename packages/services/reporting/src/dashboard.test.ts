import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { getDashboardSummary } from "./dashboard";

const KUNNR = "0010001001";
const CREDIT_HOLD_KUNNR = "0010001002";

describe("getDashboardSummary", () => {
  it("aggregates open orders and pending invoices for the customer", async () => {
    const summary = await getDashboardSummary(new MockSapAdapter(), KUNNR);

    // Seeded: one closed order is excluded, one part-delivered order counts.
    expect(summary.kpis.openOrders.count).toBe(1);
    expect(summary.kpis.openOrders.value).toBeGreaterThan(0);

    // Open + Overdue count as pending; Paid does not.
    expect(summary.kpis.pendingInvoices.count).toBe(2);
    expect(summary.recentInvoices.every((invoice) => invoice.kunnr === KUNNR)).toBe(true);
  });

  it("reports the credit position and freshness for the sync indicator", async () => {
    const summary = await getDashboardSummary(new MockSapAdapter(), KUNNR);
    expect(summary.kpis.credit?.available).toBe(
      (summary.kpis.credit?.creditLimit ?? 0) - (summary.kpis.credit?.utilized ?? 0),
    );
    expect(summary.freshness).toBe("live");
    expect(summary.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("flags a credit-hold order so the dashboard can show the alert banner", async () => {
    const held = await getDashboardSummary(new MockSapAdapter(), CREDIT_HOLD_KUNNR);
    expect(held.hasCreditHold).toBe(true);

    const clear = await getDashboardSummary(new MockSapAdapter(), KUNNR);
    expect(clear.hasCreditHold).toBe(false);
  });

  it("degrades to an empty stale summary when SAP is unreachable (docs/05 P7)", async () => {
    const summary = await getDashboardSummary(new MockSapAdapter({ unavailable: true }), KUNNR);
    expect(summary.freshness).toBe("stale");
    expect(summary.kpis.openOrders.count).toBe(0);
    expect(summary.recentOrders).toEqual([]);
  });

  it("still throws on a genuine error rather than hiding it as an outage", async () => {
    await expect(getDashboardSummary(new MockSapAdapter(), "0019999999")).rejects.toThrow(
      /not found/,
    );
  });

  it("caps the recent tables at five rows (docs/05 §7.0)", async () => {
    const summary = await getDashboardSummary(new MockSapAdapter(), KUNNR);
    expect(summary.recentOrders.length).toBeLessThanOrEqual(5);
    expect(summary.recentInvoices.length).toBeLessThanOrEqual(5);
  });
});
