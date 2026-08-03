import { MemoryCacheStore } from "@cc/adapter-cache";
import { MockSapAdapter, SEED_TODAY, SapError, type SapAdapter } from "@cc/adapter-sap";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getArSummary } from "./ar-report-service";
import { isReportingError } from "./errors";
import { getSalesReport } from "./sales-report-service";

const CONTEXT = { tenantId: "tenant-a", kunnr: "0010001001" };
const OTHER_TENANT = { tenantId: "tenant-b", kunnr: "0010001001" };

function adapter(): SapAdapter {
  return new MockSapAdapter({ today: SEED_TODAY });
}

function store() {
  return new MemoryCacheStore();
}

describe("getSalesReport", () => {
  let cache: MemoryCacheStore;

  beforeEach(() => {
    cache = store();
  });

  it("composes the whole dashboard from SAP reads and stores nothing", async () => {
    const report = await getSalesReport(adapter(), CONTEXT, {
      today: SEED_TODAY,
      period: "last-12-months",
      store: cache,
    });

    expect(report.freshness).toBe("live");
    expect(report.data.range.key).toBe("last-12-months");
    expect(report.data.ordersByMonth).toHaveLength(12);
    expect(report.data.kpis.ytdPurchases).toBeGreaterThan(0);
    expect(report.data.topProducts.length).toBeGreaterThan(0);
  });

  it("ranks top products by value, and the seeded mix is not flat", async () => {
    const report = await getSalesReport(adapter(), CONTEXT, {
      today: SEED_TODAY,
      store: cache,
    });
    const values = report.data.topProducts.map((row) => row.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("excludes the seeded cancelled order from every chart", async () => {
    const report = await getSalesReport(adapter(), CONTEXT, {
      today: SEED_TODAY,
      store: cache,
    });
    const charted = report.data.ordersByMonth.reduce((sum, b) => sum + b.orderCount, 0);
    const orders = await adapter().getOrders(CONTEXT.kunnr);
    const rejected = orders.data.items.filter((o) => o.orderStatus === "Rejected");

    expect(rejected.length).toBeGreaterThan(0);
    expect(charted).toBeLessThan(orders.data.items.length);
  });

  it("reports an on-time rate that is neither 100% nor null on the seed", async () => {
    // The seed carries two late shipments and one with no planned date on
    // purpose; a rate of exactly 100 would mean the comparison never ran.
    const report = await getSalesReport(adapter(), CONTEXT, {
      today: SEED_TODAY,
      store: cache,
    });
    expect(report.data.onTime.ratePercent).not.toBeNull();
    expect(report.data.onTime.ratePercent).toBeLessThan(100);
    expect(report.data.onTime.unmeasured).toBeGreaterThan(0);
  });

  it("serves the second read from cache, and says so", async () => {
    const sap = adapter();
    const spy = vi.spyOn(sap, "getOrders");

    const first = await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    const second = await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.freshness).toBe("live");
    expect(second.freshness).toBe("cached");
    // The "as of" is when SAP was read, not when the cache answered.
    expect(second.syncedAt).toBe(first.syncedAt);
    expect(second.data).toEqual(first.data);
  });

  it("does not share an entry between tenants", async () => {
    const sap = adapter();
    const spy = vi.spyOn(sap, "getOrders");

    await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    const other = await getSalesReport(sap, OTHER_TENANT, { today: SEED_TODAY, store: cache });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(other.freshness).toBe("live");
  });

  it("does not share an entry between two customers on one tenant", async () => {
    const sap = adapter();
    const spy = vi.spyOn(sap, "getOrders");

    await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    await getSalesReport(
      sap,
      { ...CONTEXT, kunnr: "0010001002" },
      {
        today: SEED_TODAY,
        store: cache,
      },
    );

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not share an entry between periods", async () => {
    const sap = adapter();
    const spy = vi.spyOn(sap, "getOrders");

    await getSalesReport(sap, CONTEXT, {
      today: SEED_TODAY,
      period: "last-3-months",
      store: cache,
    });
    await getSalesReport(sap, CONTEXT, {
      today: SEED_TODAY,
      period: "last-12-months",
      store: cache,
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("recomputes when asked to refresh", async () => {
    const sap = adapter();
    const spy = vi.spyOn(sap, "getOrders");

    await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    const refreshed = await getSalesReport(sap, CONTEXT, {
      today: SEED_TODAY,
      store: cache,
      refresh: true,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(refreshed.freshness).toBe("live");
  });

  it("never caches a degraded read, so an outage cannot outlive itself", async () => {
    const sap = adapter();
    vi.spyOn(sap, "getOrders").mockResolvedValue({
      data: { items: [], total: 0 },
      freshness: "stale",
      syncedAt: "2026-07-01T00:00:00.000Z",
    });

    const degraded = await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    expect(degraded.freshness).toBe("stale");

    const again = await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    expect(again.freshness).toBe("stale");
  });

  it("turns a SAP outage into a retryable 503, not a crash", async () => {
    const sap = adapter();
    vi.spyOn(sap, "getOrders").mockRejectedValue(
      new SapError("SAP is unreachable", { kind: "unavailable" }),
    );

    await expect(getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache })).rejects.toThrow(
      /couldn't reach SAP/,
    );
    try {
      await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    } catch (error) {
      expect(isReportingError(error) && error.status).toBe(503);
    }
  });

  it("rejects a period that is not in the registry", async () => {
    await expect(
      getSalesReport(adapter(), CONTEXT, {
        today: SEED_TODAY,
        period: "last-99-months",
        store: cache,
      }),
    ).rejects.toThrow(/isn't one we offer/);
  });

  it("refuses a session with no sold-to account", async () => {
    await expect(
      getSalesReport(adapter(), { tenantId: "t", kunnr: "" }, { store: cache }),
    ).rejects.toThrow(/sold-to account/);
  });
});

describe("getArSummary", () => {
  it("buckets the ledger and lists the documents under each bucket", async () => {
    const summary = await getArSummary(adapter(), CONTEXT, {
      today: SEED_TODAY,
      store: store(),
    });

    expect(summary.data.aging.totalOutstanding).toBeGreaterThan(0);
    // Every bucket is a key, including the empty ones.
    expect(Object.keys(summary.data.documents).sort()).toEqual([
      "current",
      "d31to60",
      "d61to90",
      "over90",
    ]);

    const rowTotal = Object.values(summary.data.documents)
      .flat()
      .reduce((sum, row) => sum + row.openAmount, 0);
    expect(Math.round(rowTotal * 100) / 100).toBe(summary.data.aging.totalOutstanding);
  });

  it("agrees with the aging bar bucket by bucket", async () => {
    const summary = await getArSummary(adapter(), CONTEXT, { today: SEED_TODAY, store: store() });
    for (const bucket of summary.data.aging.buckets) {
      expect(summary.data.documents[bucket.key]).toHaveLength(bucket.count);
    }
  });

  it("sorts each bucket oldest due date first", async () => {
    const summary = await getArSummary(adapter(), CONTEXT, { today: SEED_TODAY, store: store() });
    for (const rows of Object.values(summary.data.documents)) {
      const dates = rows.map((row) => row.dueDate);
      expect([...dates].sort()).toEqual(dates);
    }
  });

  it("caches under its own namespace, independently of the sales report", async () => {
    const cache = store();
    const sap = adapter();
    const openItems = vi.spyOn(sap, "getOpenItems");

    await getSalesReport(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    await getArSummary(sap, CONTEXT, { today: SEED_TODAY, store: cache });
    const second = await getArSummary(sap, CONTEXT, { today: SEED_TODAY, store: cache });

    expect(openItems).toHaveBeenCalledTimes(1);
    expect(second.freshness).toBe("cached");
  });
});
