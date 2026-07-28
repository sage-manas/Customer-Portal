import { randomUUID } from "node:crypto";

import { MockPaymentGateway } from "@cc/adapter-payment";
import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getPayment,
  handleGatewayWebhook,
  initiatePayment,
  listPayments,
  listPendingSync,
  postCapturedPayment,
} from "../payment-service";
import { listPayableItems } from "../statement-service";

/**
 * The payment vertical end to end against a real database, the mock SAP
 * driver and the mock gateway: select open items → initiate → signed webhook
 * → F-28 posting and clearing, plus the replay, partial-payment, cross-
 * account and cross-tenant cases. Requires Postgres (see the package README).
 *
 * Payments are the one O2C document the portal stores (ADR-019), which is
 * why — unlike invoices — this module has a database suite at all.
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
/** Seeded: open, 687871.56 outstanding. */
const OPEN_INVOICE = "0090002211";
/** Seeded: overdue, 143252 outstanding. */
const OVERDUE_INVOICE = "0090002190";

describe("payment flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  /** A fresh SAP + gateway pair per test: both carry mutable in-memory state. */
  function deps() {
    return { sap: new MockSapAdapter(), gateway: new MockPaymentGateway() };
  }

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.outboxEvent.deleteMany();
        await db.paymentAllocation.deleteMany();
        await db.payment.deleteMany();
      });
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `pay-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `pay-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  /** Runs the whole flow: initiate, then deliver the gateway's webhook. */
  async function pay(
    amount: number,
    documentNumber = OVERDUE_INVOICE,
    d = deps(),
    tenantId = tenantA.id,
  ) {
    const initiated = await initiatePayment(
      tenantId,
      KUNNR,
      { mode: "upi", allocations: [{ documentNumber, amount }] },
      d,
    );
    const { body, signature } = d.gateway.buildWebhook(initiated.gatewayReference);
    const result = await handleGatewayWebhook(tenantId, body, signature, d);

    return { initiated, result, deps: d };
  }

  describe("initiate", () => {
    it("records the intent and hands back a checkout URL, having charged nothing", async () => {
      const d = deps();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 1000 }] },
        d,
      );

      expect(initiated.checkoutUrl).toBeTruthy();
      expect(initiated.amount).toBe(1000);

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("initiated");
      expect(payment.fiDocumentNumber).toBeUndefined();

      // Nothing has been cleared in SAP yet.
      const payable = await listPayableItems(d.sap, KUNNR);
      const item = payable.items.find((i) => i.documentNumber === OVERDUE_INVOICE);
      expect(item?.openAmount).toBe(143252);
    });

    it("re-checks the selection against SAP rather than trusting the form", async () => {
      await expect(
        initiatePayment(
          tenantA.id,
          KUNNR,
          { mode: "upi", allocations: [{ documentNumber: "0099999999", amount: 100 }] },
          deps(),
        ),
      ).rejects.toMatchObject({ code: "not_payable" });
    });

    it("refuses to overpay an item", async () => {
      await expect(
        initiatePayment(
          tenantA.id,
          KUNNR,
          { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 999999999 }] },
          deps(),
        ),
      ).rejects.toMatchObject({ code: "not_payable" });
    });

    it("refuses another customer's open item without confirming it exists", async () => {
      await expect(
        initiatePayment(
          tenantA.id,
          KUNNR,
          // 0090002205 belongs to OTHER_KUNNR.
          { mode: "upi", allocations: [{ documentNumber: "0090002205", amount: 100 }] },
          deps(),
        ),
      ).rejects.toMatchObject({ code: "not_payable" });
    });

    it("closes the row when the gateway can't be reached, and says nothing was charged", async () => {
      const d = {
        sap: new MockSapAdapter(),
        gateway: new MockPaymentGateway({ unavailable: true }),
      };

      await expect(
        initiatePayment(
          tenantA.id,
          KUNNR,
          { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 100 }] },
          d,
        ),
      ).rejects.toMatchObject({ code: "gateway_unavailable", status: 503 });

      const payments = await listPayments(tenantA.id, KUNNR);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.status).toBe("failed");
    });
  });

  describe("webhook", () => {
    it("posts to SAP and clears the item on a full payment", async () => {
      const { initiated, result, deps: d } = await pay(143252);

      expect(result.applied).toBe(true);
      expect(result.status).toBe("posted");
      expect(result.fiDocumentNumber).toBeTruthy();

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("posted");
      expect(payment.clearedItems).toEqual([OVERDUE_INVOICE]);
      expect(payment.residualItems).toEqual([]);

      // SAP agrees: the item is gone from what's payable.
      const payable = await listPayableItems(d.sap, KUNNR);
      expect(payable.items.map((i) => i.documentNumber)).not.toContain(OVERDUE_INVOICE);
    });

    it("leaves a residual open item on a partial payment", async () => {
      const { initiated, deps: d } = await pay(43252);

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.clearedItems).toEqual([]);
      expect(payment.residualItems).toEqual([OVERDUE_INVOICE]);

      const payable = await listPayableItems(d.sap, KUNNR);
      const item = payable.items.find((i) => i.documentNumber === OVERDUE_INVOICE);
      expect(item?.openAmount).toBe(100000);
    });

    it("rejects an unsigned or tampered notification", async () => {
      const d = deps();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 100 }] },
        d,
      );
      const { body } = d.gateway.buildWebhook(initiated.gatewayReference);

      await expect(
        handleGatewayWebhook(tenantA.id, body, "not-a-signature", d),
      ).rejects.toMatchObject({ code: "invalid_signature", status: 400 });

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("initiated");
    });

    it("applies a replayed webhook exactly once", async () => {
      const d = deps();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 143252 }] },
        d,
      );
      const { body, signature } = d.gateway.buildWebhook(initiated.gatewayReference);

      const first = await handleGatewayWebhook(tenantA.id, body, signature, d);
      const second = await handleGatewayWebhook(tenantA.id, body, signature, d);

      expect(first.applied).toBe(true);
      expect(second.applied).toBe(false);
      // The same FI document, not a second posting.
      expect(second.fiDocumentNumber).toBe(first.fiDocumentNumber);

      const payable = await listPayableItems(d.sap, KUNNR);
      expect(payable.items.map((i) => i.documentNumber)).not.toContain(OVERDUE_INVOICE);
    });

    it("records a failed payment without touching SAP", async () => {
      // .13 paise makes the mock gateway decline (see outcomeFor).
      const { initiated, result, deps: d } = await pay(100.13);

      expect(result.status).toBe("failed");

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("failed");
      expect(payment.failureReason).toBeTruthy();

      const payable = await listPayableItems(d.sap, KUNNR);
      const item = payable.items.find((i) => i.documentNumber === OVERDUE_INVOICE);
      expect(item?.openAmount).toBe(143252);
    });

    it("leaves a pending payment alone until it resolves", async () => {
      // .11 paise makes the mock gateway report pending.
      const { initiated, result } = await pay(100.11);

      expect(result.applied).toBe(false);
      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("initiated");
    });

    it("ignores a webhook for a payment this tenant doesn't have", async () => {
      const d = deps();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 100 }] },
        d,
      );
      const { body, signature } = d.gateway.buildWebhook(initiated.gatewayReference);

      // Same signed body, delivered against the wrong tenant.
      const result = await handleGatewayWebhook(tenantB.id, body, signature, d);
      expect(result.applied).toBe(false);

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("initiated");
    });
  });

  describe("posting failures leave the money accounted for", () => {
    it("keeps the payment captured when SAP won't post, rather than failing it", async () => {
      const gateway = new MockPaymentGateway();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 143252 }] },
        { sap: new MockSapAdapter(), gateway },
      );
      const { body, signature } = gateway.buildWebhook(initiated.gatewayReference);

      await expect(
        handleGatewayWebhook(tenantA.id, body, signature, {
          sap: new MockSapAdapter({ unavailable: true }),
          gateway,
        }),
      ).rejects.toMatchObject({ code: "posting_failed", status: 202 });

      // The capture is recorded even though the posting failed — that is the
      // whole reason payments are stored (ADR-019).
      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.status).toBe("captured");
      expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(1);
    });

    it("lets reconciliation retry the posting later without double-charging", async () => {
      const gateway = new MockPaymentGateway();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 143252 }] },
        { sap: new MockSapAdapter(), gateway },
      );
      const { body, signature } = gateway.buildWebhook(initiated.gatewayReference);

      await handleGatewayWebhook(tenantA.id, body, signature, {
        sap: new MockSapAdapter({ unavailable: true }),
        gateway,
      }).catch(() => undefined);

      const sap = new MockSapAdapter();
      const retried = await postCapturedPayment(tenantA.id, initiated.paymentId, sap);

      expect(retried.status).toBe("posted");
      expect(retried.fiDocumentNumber).toBeTruthy();
      expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(0);

      // Retrying again is a no-op, not a second posting.
      const again = await postCapturedPayment(tenantA.id, initiated.paymentId, sap);
      expect(again.fiDocumentNumber).toBe(retried.fiDocumentNumber);
    });
  });

  describe("isolation", () => {
    it("does not return a payment to another tenant", async () => {
      const { initiated } = await pay(1000);

      await expect(getPayment(tenantB.id, KUNNR, initiated.paymentId)).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    });

    it("does not return a payment to another sold-to account", async () => {
      const { initiated } = await pay(1000);

      await expect(getPayment(tenantA.id, OTHER_KUNNR, initiated.paymentId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("keeps each tenant's payment list to itself", async () => {
      await pay(1000);

      expect(await listPayments(tenantA.id, KUNNR)).toHaveLength(1);
      expect(await listPayments(tenantB.id, KUNNR)).toHaveLength(0);
    });

    it("gives the same 404 for a payment that never existed", async () => {
      await expect(getPayment(tenantA.id, KUNNR, "clnonexistent000000000")).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe("amounts survive Prisma's Decimal", () => {
    it("round-trips paise without drifting", async () => {
      const { initiated } = await pay(1234.57, OPEN_INVOICE);

      const payment = await getPayment(tenantA.id, KUNNR, initiated.paymentId);
      expect(payment.amount).toBe(1234.57);
      expect(payment.allocations[0]?.amount).toBe(1234.57);
    });
  });

  describe("outbox (ADR-023)", () => {
    async function events(tenantId = tenantA.id) {
      return runWithTenant(tenantId, () =>
        db.outboxEvent.findMany({ orderBy: { createdAt: "asc" } }),
      );
    }

    it("records captured and posted in the transactions that made them true", async () => {
      const { initiated } = await pay(1000);

      const rows = await events();
      const names = rows.map((row) => row.eventName);

      expect(names).toContain("payment.captured");
      expect(names).toContain("payment.posted");
      expect(rows.every((row) => row.state === "pending")).toBe(true);
      // Keyed on the payment, not the gateway event: a redelivery and a
      // reconciliation retry describe the same capture.
      expect(rows.map((row) => row.dedupeKey)).toContain(`payment.captured:${initiated.paymentId}`);
    });

    it("emits one captured event however many times the webhook is redelivered", async () => {
      const d = deps();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 1000 }] },
        d,
      );
      const { body, signature } = d.gateway.buildWebhook(initiated.gatewayReference);

      await handleGatewayWebhook(tenantA.id, body, signature, d);
      await handleGatewayWebhook(tenantA.id, body, signature, d);

      const captured = (await events()).filter((row) => row.eventName === "payment.captured");
      expect(captured).toHaveLength(1);
    });

    it("emits no posted event when SAP refuses the posting", async () => {
      const gateway = new MockPaymentGateway();
      const initiated = await initiatePayment(
        tenantA.id,
        KUNNR,
        { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 1000 }] },
        { sap: new MockSapAdapter(), gateway },
      );
      const { body, signature } = gateway.buildWebhook(initiated.gatewayReference);

      await expect(
        handleGatewayWebhook(tenantA.id, body, signature, {
          sap: new MockSapAdapter({ unavailable: true }),
          gateway,
        }),
      ).rejects.toMatchObject({ code: "posting_failed" });

      const names = (await events()).map((row) => row.eventName);
      // The capture happened and is announced; the posting did not, so no
      // "payment confirmed" event exists to tell the customer otherwise.
      expect(names).toContain("payment.captured");
      expect(names).not.toContain("payment.posted");
    });

    it("keeps each tenant's events to itself", async () => {
      await pay(1000);
      expect(await events(tenantB.id)).toEqual([]);
    });
  });
});
