import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { listCreditBlockedOrders, releaseCreditBlock } from "./credit-release-service";
import { isOrderError } from "./errors";

const adapter = () => new MockSapAdapter({ today: SEED_TODAY });

describe("listCreditBlockedOrders", () => {
  it("lists only held orders, longest-waiting first", async () => {
    const queue = await listCreditBlockedOrders(adapter(), { today: SEED_TODAY });

    expect(queue.rows.length).toBeGreaterThan(0);
    expect(queue.rows.every((r) => r.order.creditStatus === "CreditHold")).toBe(true);
    const days = queue.rows.map((r) => r.blockedDays);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });

  it("totals what SAP is holding", async () => {
    const queue = await listCreditBlockedOrders(adapter(), { today: SEED_TODAY });
    expect(queue.blockedValue).toBeCloseTo(
      queue.rows.reduce((sum, r) => sum + r.order.netValue, 0),
      2,
    );
  });

  it("reports a SAP outage rather than an empty queue", async () => {
    await expect(
      listCreditBlockedOrders(new MockSapAdapter({ unavailable: true })),
    ).rejects.toSatisfy(isOrderError);
  });
});

describe("releaseCreditBlock", () => {
  it("releases an order that now fits, and it leaves the queue", async () => {
    const sap = adapter();
    const queue = await listCreditBlockedOrders(sap, { today: SEED_TODAY });
    const releasable = queue.rows.find((r) => r.order.vbeln === "0000004714")!;

    const result = await releaseCreditBlock(sap, {
      vbeln: releasable.order.vbeln,
      initiatedBy: "user-ar-1",
    });

    expect(result).toMatchObject({ released: true, creditStatus: "Confirmed" });
    const after = await listCreditBlockedOrders(sap, { today: SEED_TODAY });
    expect(after.rows.map((r) => r.order.vbeln)).not.toContain(releasable.order.vbeln);
  });

  it("reports a refused release as a result, not an error — VKM3 re-checks", async () => {
    const sap = adapter();

    const result = await releaseCreditBlock(sap, { vbeln: "0000004713" });

    expect(result.released).toBe(false);
    expect(result.creditStatus).toBe("CreditHold");
    expect(result.reason).toBeTruthy();
  });

  it("404s an order that does not exist", async () => {
    await expect(releaseCreditBlock(adapter(), { vbeln: "0000009999" })).rejects.toSatisfy(
      isOrderError,
    );
  });
});
