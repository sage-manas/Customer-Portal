import { MockSapAdapter, SEED_TODAY } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { isLoyaltyError } from "./errors";
import { listRebateSettlements, settleRebate } from "./rebate-desk-service";

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

describe("settleRebate", () => {
  it("settles the agreement SAP released, and it leaves the settleable queue", async () => {
    const sap = adapter();
    const settleable = (
      await listRebateSettlements(sap, { today: SEED_TODAY, filter: "settleable" })
    ).rows[0]!;

    const result = await settleRebate(
      sap,
      { agreementNumber: settleable.agreement.agreementNumber, initiatedBy: "user-ap-1" },
      { today: SEED_TODAY },
    );

    expect(result.settlementStatus).toBe("D");
    expect(result.settledAmount).toBe(settleable.agreement.accruedAmount);
    expect(result.creditMemoRequest).toMatch(/^\d{10}$/);

    const after = await listRebateSettlements(sap, { today: SEED_TODAY, filter: "settleable" });
    expect(after.rows.map((r) => r.agreement.agreementNumber)).not.toContain(
      settleable.agreement.agreementNumber,
    );
  });

  it("explains a refusal in the desk's language rather than SAP's", async () => {
    const sap = adapter();
    const open = (await listRebateSettlements(sap, { today: SEED_TODAY })).rows.find(
      (r) => r.state.code === "B",
    )!;

    const error = await settleRebate(
      sap,
      { agreementNumber: open.agreement.agreementNumber },
      { today: SEED_TODAY },
    ).catch((e: unknown) => e);

    expect(isLoyaltyError(error)).toBe(true);
    expect((error as { issues: { message: string }[] }).issues[0]?.message).toContain("VBO2");
  });

  it("404s an agreement this tenant does not have", async () => {
    await expect(
      settleRebate(adapter(), { agreementNumber: "0000000000" }, { today: SEED_TODAY }),
    ).rejects.toSatisfy(isLoyaltyError);
  });
});
