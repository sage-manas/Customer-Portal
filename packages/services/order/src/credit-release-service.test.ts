import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { listCreditBlockedOrders } from "./credit-release-service";
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
