import { randomUUID } from "node:crypto";

import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { DEFAULT_TIER_THRESHOLDS } from "@cc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  decideCreditRequest,
  getCreditRequestForDesk,
  listCreditRequestQueue,
} from "../credit-desk-service";
import {
  getCreditRequest,
  listCreditRequests,
  requestCreditIncrease,
  withdrawCreditRequest,
} from "../credit-request-service";
import { isLoyaltyError } from "../errors";
import { getLoyaltyPosition } from "../loyalty-service";
import { getTierThresholds, saveTierThresholds } from "../tier-settings";

/**
 * Module 9 end to end against a real database and the mock SAP driver: ask for
 * a bigger limit, see it in the desk's queue, have it decided, and fail to
 * reach another account's or another tenant's.
 *
 * The tier half is here too rather than in the unit suite because the tenant's
 * thresholds are rows — the point being tested is that a tenant editing its
 * ladder re-tiers its customers on the *next read*, with nothing stored about
 * any customer's tier at all.
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
const TODAY = "2026-07-26";

const sap = (options = {}) => new MockSapAdapter({ today: TODAY, ...options });

const validRequest = {
  requestedLimit: 7_500_000,
  justification: "We're commissioning a second line in October and expect to double volumes.",
};

async function expectLoyaltyError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isLoyaltyError(error)) return error;
    throw error;
  }
  throw new Error("Expected a LoyaltyError to be thrown");
}

describe("credit and loyalty flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  const context = () => ({ tenantId: tenantA.id, kunnr: KUNNR, userId: `buyer-${runId}` });
  const desk = () => ({ tenantId: tenantA.id, userId: `desk-${runId}` });

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.creditLimitRequest.deleteMany();
        await db.loyaltyTierSetting.deleteMany();
        await db.outboxEvent.deleteMany();
      });
    }
  }

  async function events(tenantId: string) {
    return runWithTenant(tenantId, () =>
      db.outboxEvent.findMany({ orderBy: { createdAt: "asc" } }),
    );
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `loyalty-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `loyalty-b-${runId}`, name: "Tenant B" } });
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  describe("the tenant's tier ladder", () => {
    it("is the registry's until the tenant changes it", async () => {
      expect(await getTierThresholds(tenantA.id)).toEqual(DEFAULT_TIER_THRESHOLDS);
    });

    it("re-tiers a customer on the next read, with nothing stored about them", async () => {
      const before = await getLoyaltyPosition(sap(), context(), { today: TODAY });
      expect(before.standing.tier.key).toBe("silver");
      expect(before.fiscalYear.label).toBe("FY 2026-27");

      // The tenant decides Gold starts lower. No customer row is touched.
      await saveTierThresholds(tenantA.id, { silver: 500_000, gold: 1_000_000 });

      const after = await getLoyaltyPosition(sap(), context(), { today: TODAY });
      expect(after.standing.ytdValue).toBe(before.standing.ytdValue);
      // Same purchases, different ladder, higher tier — and Platinum is still
      // the registry default of 2.5 crore, because the tenant left it alone.
      expect(after.standing.tier.key).toBe("gold");
      expect(after.standing.thresholds.platinum).toBe(DEFAULT_TIER_THRESHOLDS.platinum);
    });

    it("refuses a ladder that doesn't ascend, and changes nothing", async () => {
      const error = await expectLoyaltyError(() =>
        saveTierThresholds(tenantA.id, { silver: 12_000_000 }),
      );
      expect(error.code).toBe("invalid");
      expect(await getTierThresholds(tenantA.id)).toEqual(DEFAULT_TIER_THRESHOLDS);
    });

    it("keeps each tenant's ladder to itself", async () => {
      await saveTierThresholds(tenantA.id, { gold: 8_000_000 });
      expect(await getTierThresholds(tenantB.id)).toEqual(DEFAULT_TIER_THRESHOLDS);
    });
  });

  describe("the rebate panel", () => {
    it("shows only agreements that are live today", async () => {
      const position = await getLoyaltyPosition(sap(), context(), { today: TODAY });

      expect(position.allRebates.length).toBeGreaterThan(position.rebates.length);
      expect(position.rebates.every((r) => r.validTo >= TODAY)).toBe(true);
      // KONA-KAWRT as SAP holds it — never recomputed from the invoices.
      expect(position.accruedRebate).toBe(138034);
    });

    it("still reports a tier when KONA can't be read", async () => {
      const adapter = sap();
      adapter.getRebateAgreements = () => Promise.reject(new Error("KONA unavailable"));

      const position = await getLoyaltyPosition(adapter, context(), { today: TODAY });
      expect(position.standing.tier.key).toBe("silver");
      expect(position.rebates).toEqual([]);
    });
  });

  describe("raising a request", () => {
    it("records the ask with the limit as it stood, and emits the event in the same transaction", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      expect(request.status).toBe("pending");
      expect(request.requestedLimit).toBe(7_500_000);
      // The seeded KNKK limit for this account — read from SAP, not the form.
      expect(request.currentLimit).toBe(5_000_000);

      const written = await events(tenantA.id);
      expect(written).toHaveLength(1);
      expect(written[0]?.eventName).toBe("credit.increase.requested");
      expect(written[0]?.dedupeKey).toBe(`credit.increase.requested:${request.id}`);
    });

    it("refuses a second ask while one is still with the desk", async () => {
      await requestCreditIncrease(sap(), context(), validRequest);

      const error = await expectLoyaltyError(() =>
        requestCreditIncrease(sap(), context(), validRequest),
      );
      expect(error.code).toBe("already_pending");
    });

    it("refuses an ask that isn't an increase, as a field issue", async () => {
      const error = await expectLoyaltyError(() =>
        requestCreditIncrease(sap(), context(), { ...validRequest, requestedLimit: 1_000_000 }),
      );
      expect(error.code).toBe("invalid");
      expect(error.issues[0]?.field).toBe("requestedLimit");
    });

    it("refuses a justification too thin to decide on", async () => {
      const error = await expectLoyaltyError(() =>
        requestCreditIncrease(sap(), context(), { ...validRequest, justification: "need more" }),
      );
      expect(error.code).toBe("invalid");
    });

    it("writes nothing when SAP can't be reached for the current limit", async () => {
      const error = await expectLoyaltyError(() =>
        requestCreditIncrease(sap({ unavailable: true }), context(), validRequest),
      );
      expect(error.code).toBe("upstream_unavailable");

      const list = await listCreditRequests(context());
      expect(list.requests).toEqual([]);
      expect(await events(tenantA.id)).toEqual([]);
    });
  });

  describe("the desk", () => {
    it("sees pending work across accounts, oldest first", async () => {
      await requestCreditIncrease(sap(), context(), validRequest);
      await requestCreditIncrease(
        sap(),
        { ...context(), kunnr: OTHER_KUNNR },
        { ...validRequest, requestedLimit: 3_000_000 },
      );

      const queue = await listCreditRequestQueue(desk());

      expect(queue.requests).toHaveLength(2);
      expect(queue.counts.pending).toBe(2);
      expect(queue.requests[0]?.customerKunnr).toBe(KUNNR);
    });

    it("approves for what was asked unless it says otherwise", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      const decided = await decideCreditRequest(desk(), request.id, { decision: "approved" });

      expect(decided.status).toBe("approved");
      expect(decided.approvedLimit).toBe(7_500_000);
      expect(decided.decidedByUserId).toBe(`desk-${runId}`);

      const written = await events(tenantA.id);
      expect(written.map((event) => event.eventName)).toEqual([
        "credit.increase.requested",
        "credit.increase.decided",
      ]);
    });

    it("may counter-offer a smaller limit", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      const decided = await decideCreditRequest(desk(), request.id, {
        decision: "approved",
        approvedLimit: 6_000_000,
        note: "Approved to 60 lakh pending the Q3 accounts.",
      });

      expect(decided.approvedLimit).toBe(6_000_000);
      expect(decided.decisionNote).toContain("60 lakh");
    });

    it("leaves the customer's SAP limit exactly where it was (ADR-035)", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);
      await decideCreditRequest(desk(), request.id, { decision: "approved" });

      // The decision is a record of what the desk agreed. KLIMK moves in FD32,
      // and nothing in this module writes it — so the customer's position is
      // unchanged until somebody maintains it in SAP.
      const credit = await sap().getCreditInfo(KUNNR);
      expect(credit.data.creditLimit).toBe(5_000_000);
    });

    it("decides a request once, whichever desk user gets there second", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);
      await decideCreditRequest(desk(), request.id, { decision: "approved" });

      const error = await expectLoyaltyError(() =>
        decideCreditRequest(desk(), request.id, { decision: "rejected" }),
      );
      expect(error.code).toBe("not_allowed");

      const still = await getCreditRequestForDesk(desk(), request.id);
      expect(still.status).toBe("approved");
    });

    it("cannot decide a request that belongs to another tenant", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      const error = await expectLoyaltyError(() =>
        decideCreditRequest({ tenantId: tenantB.id }, request.id, { decision: "approved" }),
      );
      expect(error.code).toBe("not_found");
    });
  });

  describe("the customer's own view", () => {
    it("404s another account's request rather than showing it", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      const error = await expectLoyaltyError(() =>
        getCreditRequest({ ...context(), kunnr: OTHER_KUNNR }, request.id),
      );
      expect(error.code).toBe("not_found");
    });

    it("lets the customer withdraw, but never decide", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);

      const withdrawn = await withdrawCreditRequest(context(), request.id);
      expect(withdrawn.status).toBe("withdrawn");

      // And withdrawing frees them to ask again, which is the point of it.
      const again = await requestCreditIncrease(sap(), context(), validRequest);
      expect(again.status).toBe("pending");
    });

    it("cannot withdraw a request the desk has already decided", async () => {
      const request = await requestCreditIncrease(sap(), context(), validRequest);
      await decideCreditRequest(desk(), request.id, { decision: "rejected" });

      const error = await expectLoyaltyError(() => withdrawCreditRequest(context(), request.id));
      expect(error.code).toBe("not_allowed");
    });
  });
});
