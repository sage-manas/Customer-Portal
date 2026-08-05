import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { isLoyaltyError } from "./errors";
import { listRebateSettlements } from "./rebate-desk-service";

const adapter = () => new MockSapAdapter({ today: SEED_TODAY });

describe("listRebateSettlements", () => {
  it("spans accounts — this is a desk read, not a customer's", async () => {
    const queue = await listRebateSettlements(adapter(), { today: SEED_TODAY });
    expect(new Set(queue.rows.map((r) => r.agreement.kunnr)).size).toBeGreaterThan(1);
    expect(queue.freshness).toBe("live");
  });

  it("keeps settled agreements under `all` and drops them under `open`", async () => {
    const all = await listRebateSettlements(adapter(), { today: SEED_TODAY, filter: "all" });
    const open = await listRebateSettlements(adapter(), { today: SEED_TODAY, filter: "open" });

    expect(all.rows.some((r) => r.state.code === "D")).toBe(true);
    expect(open.rows.some((r) => r.state.code === "D")).toBe(false);
  });

  it("counts only what SAP released toward the settleable value", async () => {
    const queue = await listRebateSettlements(adapter(), { today: SEED_TODAY });
    const settleable = queue.rows.filter((r) => r.state.settleable);
    expect(queue.releasedValue).toBeCloseTo(
      settleable.reduce((sum, r) => sum + r.agreement.accruedAmount, 0),
      2,
    );
  });

  it("reports a SAP outage rather than an empty queue", async () => {
    await expect(
      listRebateSettlements(new MockSapAdapter({ unavailable: true })),
    ).rejects.toSatisfy(isLoyaltyError);
  });
});
