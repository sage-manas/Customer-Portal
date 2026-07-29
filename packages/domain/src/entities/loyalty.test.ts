import { describe, expect, it } from "vitest";

import {
  CREDIT_INCREASE_MAX_MULTIPLE,
  CREDIT_UTILIZATION_CRITICAL,
  canTransitionCreditRequest,
  computeDso,
  creditBand,
  creditIncreaseIssue,
  creditIncreaseRequestSchema,
  creditPosition,
  dsoFromDocuments,
  DEFAULT_TIER_THRESHOLDS,
  fiscalYearPurchases,
  fiscalYearRange,
  loyaltyStanding,
  resolveTierThresholds,
  tierThresholdOverridesSchema,
  utilizationRatio,
} from "./loyalty";
import type { Invoice, OpenItem } from "./sales-doc";

const invoice = (over: Partial<Invoice> & Pick<Invoice, "vbeln" | "billingDate">): Invoice => ({
  kunnr: "0010001001",
  taxableAmount: 100000,
  cgst: 9000,
  sgst: 9000,
  igst: 0,
  grossAmount: 118000,
  currency: "INR",
  dueDate: "2026-08-25",
  status: "Open",
  ...over,
});

describe("the fiscal year", () => {
  it("runs April to March, so a July date is early in its own year", () => {
    expect(fiscalYearRange("2026-07-29")).toEqual({
      start: "2026-04-01",
      end: "2027-03-31",
      label: "FY 2026-27",
    });
  });

  it("puts January back into the previous fiscal year", () => {
    expect(fiscalYearRange("2027-01-15")).toMatchObject({
      start: "2026-04-01",
      end: "2027-03-31",
    });
  });

  it("treats 1 April as the first day of the new year, not the last of the old", () => {
    expect(fiscalYearRange("2026-04-01").start).toBe("2026-04-01");
    expect(fiscalYearRange("2026-03-31").end).toBe("2026-03-31");
  });
});

describe("fiscalYearPurchases", () => {
  const range = fiscalYearRange("2026-07-29");

  it("sums taxable value inside the year and ignores everything outside it", () => {
    const total = fiscalYearPurchases(
      [
        invoice({ vbeln: "9000000001", billingDate: "2026-05-02", taxableAmount: 400000 }),
        invoice({ vbeln: "9000000002", billingDate: "2026-07-01", taxableAmount: 250000 }),
        // Last fiscal year — the customer's tier restarted on 1 April.
        invoice({ vbeln: "9000000003", billingDate: "2026-03-30", taxableAmount: 900000 }),
      ],
      range,
    );

    expect(total).toBe(650000);
  });

  it("lets credit notes reduce it, using the sign SAP already put on them", () => {
    const total = fiscalYearPurchases(
      [
        invoice({ vbeln: "9000000001", billingDate: "2026-05-02", taxableAmount: 400000 }),
        invoice({
          vbeln: "9000000004",
          billingDate: "2026-06-10",
          billingType: "G2",
          // A G2 comes off VBRK negative; re-signing it here would flip a
          // refund back into a purchase.
          taxableAmount: -150000,
        }),
      ],
      range,
    );

    expect(total).toBe(250000);
  });

  it("never goes negative, so a net-refund year is zero rather than below Bronze", () => {
    const total = fiscalYearPurchases(
      [
        invoice({
          vbeln: "9000000004",
          billingDate: "2026-06-10",
          billingType: "G2",
          taxableAmount: -150000,
        }),
      ],
      range,
    );

    expect(total).toBe(0);
  });
});

describe("loyaltyStanding", () => {
  it("places an account on the highest tier it has reached", () => {
    expect(loyaltyStanding(0).tier.key).toBe("bronze");
    expect(loyaltyStanding(2_500_000).tier.key).toBe("silver");
    expect(loyaltyStanding(9_999_999).tier.key).toBe("silver");
    expect(loyaltyStanding(10_000_000).tier.key).toBe("gold");
    expect(loyaltyStanding(40_000_000).tier.key).toBe("platinum");
  });

  it("reports what the next tier costs from here", () => {
    const standing = loyaltyStanding(4_000_000);
    expect(standing.nextTier?.key).toBe("gold");
    expect(standing.amountToNextTier).toBe(6_000_000);
    expect(standing.progressPercent).toBeCloseTo(20, 1);
  });

  it("fills the bar at the top of the ladder rather than leaving it unfinishable", () => {
    const standing = loyaltyStanding(30_000_000);
    expect(standing.nextTier).toBeNull();
    expect(standing.amountToNextTier).toBe(0);
    expect(standing.progressPercent).toBe(100);
  });

  it("uses the tenant's thresholds when it has its own", () => {
    const thresholds = resolveTierThresholds({ silver: 100_000, gold: 200_000 });
    expect(loyaltyStanding(150_000, thresholds).tier.key).toBe("silver");
    expect(loyaltyStanding(150_000, DEFAULT_TIER_THRESHOLDS).tier.key).toBe("bronze");
  });
});

describe("tier threshold overrides", () => {
  it("fills the gaps from the registry and pins the entry tier at zero", () => {
    expect(resolveTierThresholds({ gold: 8_000_000 })).toEqual({
      ...DEFAULT_TIER_THRESHOLDS,
      gold: 8_000_000,
    });
    expect(resolveTierThresholds({}).bronze).toBe(0);
  });

  it("refuses thresholds that cross, which would silently mis-tier customers", () => {
    // Silver moved above the default Gold: the ladder no longer ascends.
    const parsed = tierThresholdOverridesSchema.safeParse({ silver: 12_000_000 });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(["gold"]);
  });

  it("refuses a non-zero entry tier", () => {
    expect(tierThresholdOverridesSchema.safeParse({ bronze: 5000 }).success).toBe(false);
  });

  it("accepts a complete, ascending ladder", () => {
    expect(
      tierThresholdOverridesSchema.safeParse({
        bronze: 0,
        silver: 500_000,
        gold: 1_000_000,
        platinum: 5_000_000,
      }).success,
    ).toBe(true);
  });
});

describe("the credit band", () => {
  const info = { creditLimit: 1_000_000, utilized: 0, blocked: false };

  it("follows the doc's thresholds", () => {
    expect(creditBand({ ...info, utilized: 700_000 })).toBe("healthy");
    expect(creditBand({ ...info, utilized: 800_000 })).toBe("warning");
    expect(creditBand({ ...info, utilized: 960_000 })).toBe("critical");
  });

  it("reports a block regardless of how much headroom the number shows", () => {
    expect(creditBand({ ...info, utilized: 100_000, blocked: true })).toBe("blocked");
  });

  it("treats an account with no limit as healthy, not fully utilised", () => {
    expect(utilizationRatio({ creditLimit: 0, utilized: 0 })).toBe(0);
    expect(creditBand({ creditLimit: 0, utilized: 0, blocked: false })).toBe("healthy");
  });

  it("derives available and the percentage rather than trusting the read", () => {
    const position = creditPosition({
      kunnr: "0010001001",
      creditLimit: 1_000_000,
      utilized: 955_000,
      // Deliberately wrong on the incoming read — the derived value wins.
      available: 999_999,
      blocked: false,
      currency: "INR",
    });

    expect(position.available).toBe(45_000);
    expect(position.utilizationPercent).toBe(95.5);
    expect(position.utilizationRatio).toBeGreaterThanOrEqual(CREDIT_UTILIZATION_CRITICAL);
    expect(position.band).toBe("critical");
    expect(position.message).toContain("close to your credit limit");
  });
});

describe("DSO", () => {
  it("is receivables over sales, scaled to the window", () => {
    expect(computeDso(300_000, 900_000, 90)).toBe(30);
  });

  it("is null when there were no sales to be outstanding against", () => {
    expect(computeDso(300_000, 0, 90)).toBeNull();
  });

  it("measures only the trailing window's billing", () => {
    const openItems: OpenItem[] = [
      {
        documentNumber: "9000000001",
        documentType: "RV",
        postingDate: "2026-06-01",
        dueDate: "2026-07-01",
        amount: 118000,
        openAmount: 118000,
        status: "Overdue",
        currency: "INR",
      },
    ];

    const dso = dsoFromDocuments(
      openItems,
      [
        invoice({ vbeln: "9000000001", billingDate: "2026-06-01", grossAmount: 118000 }),
        // Outside the 90-day window — it is not part of the run rate.
        invoice({ vbeln: "9000000000", billingDate: "2026-01-05", grossAmount: 5_000_000 }),
      ],
      { today: "2026-07-29" },
    );

    expect(dso).toBe(90);
  });
});

describe("the credit-increase request", () => {
  it("requires a justification a credit desk can actually decide on", () => {
    expect(
      creditIncreaseRequestSchema.safeParse({
        requestedLimit: 5_000_000,
        justification: "need more",
      }).success,
    ).toBe(false);
    expect(
      creditIncreaseRequestSchema.safeParse({
        requestedLimit: 5_000_000,
        justification:
          "We're commissioning a second line in October and expect to double monthly volumes.",
      }).success,
    ).toBe(true);
  });

  it("refuses an ask that isn't an increase", () => {
    expect(creditIncreaseIssue(1_000_000, 1_000_000)).toContain("already");
    expect(creditIncreaseIssue(900_000, 1_000_000)).toContain("already");
    expect(creditIncreaseIssue(1_500_000, 1_000_000)).toBeNull();
  });

  it("catches the extra zero", () => {
    const overshoot = 1_000_000 * CREDIT_INCREASE_MAX_MULTIPLE + 1;
    expect(creditIncreaseIssue(overshoot, 1_000_000)).toContain("current limit");
  });

  it("has no ceiling for an account that has no limit yet", () => {
    expect(creditIncreaseIssue(500_000, 0)).toBeNull();
  });

  it("lets only the credit desk approve, and only the customer withdraw", () => {
    expect(canTransitionCreditRequest("pending", "approved", "credit_desk")).toBe(true);
    expect(canTransitionCreditRequest("pending", "approved", "customer")).toBe(false);
    expect(canTransitionCreditRequest("pending", "withdrawn", "customer")).toBe(true);
    expect(canTransitionCreditRequest("pending", "withdrawn", "credit_desk")).toBe(false);
    // Terminal is terminal — a decided request is re-asked, not re-decided.
    expect(canTransitionCreditRequest("approved", "rejected", "credit_desk")).toBe(false);
  });
});
