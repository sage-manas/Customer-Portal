import { randomUUID } from "node:crypto";

import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDelivery } from "../delivery-service";
import { isDeliveryError } from "../errors";
import { confirmReceipt } from "../pod-service";
import { findPodConfirmation } from "../pod-store";

/**
 * The POD vertical end to end against a real database and the mock SAP
 * driver: confirm -> SAP holds the receipt, the portal holds the evidence,
 * and the outbox holds the event — plus the cross-account and cross-tenant
 * 404 cases. Requires Postgres (see the package README).
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
/** In transit with 150 M dispatched on one line — the confirmable one. */
const DELIVERY = "0080001947";
const TODAY = "2026-07-26";

const sap = () => new MockSapAdapter({ today: TODAY });

const cleanReceipt = {
  receiptDate: TODAY,
  lines: [{ lineNo: 10, receivedQty: 150 }],
};

async function expectDeliveryError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isDeliveryError(error)) return error;
    throw error;
  }
  throw new Error("Expected a DeliveryError to be thrown");
}

describe("proof of delivery flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.podConfirmationLine.deleteMany();
        await db.podConfirmation.deleteMany();
        await db.outboxEvent.deleteMany();
      });
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `pod-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `pod-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  const context = (over: Record<string, unknown> = {}) => ({
    tenantId: tenantA.id,
    kunnr: KUNNR,
    userId: "user-1",
    ...over,
  });

  it("records a clean receipt in SAP and keeps the evidence in the portal", async () => {
    const adapter = sap();
    const result = await confirmReceipt(adapter, context(), DELIVERY, cleanReceipt, {
      today: TODAY,
    });

    expect(result.discrepancy.hasDiscrepancy).toBe(false);
    expect(result.status).toBe("Delivered");
    expect(result.pod.outcome).toBe("confirmed");

    // SAP owns the receipt itself (ADR-026): the flag comes back on the read.
    const inSap = await adapter.getDelivery(DELIVERY);
    expect(inSap.data.podConfirmed).toBe(true);
    expect(inSap.data.podReceiptDate).toBe(TODAY);

    // The portal owns the evidence, and only the evidence.
    const stored = await findPodConfirmation(tenantA.id, KUNNR, DELIVERY);
    expect(stored?.lines).toEqual([
      { lineNo: 10, material: "MAT-20002", dispatchedQty: 150, receivedQty: 150 },
    ]);
  });

  it("emits the receipt event in the same transaction (ADR-023)", async () => {
    await confirmReceipt(sap(), context(), DELIVERY, cleanReceipt, { today: TODAY });

    const events = await runWithTenant(tenantA.id, () => db.outboxEvent.findMany());

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventName: "delivery.receipt.confirmed",
      queue: "notifications",
      state: "pending",
      dedupeKey: `delivery.receipt.confirmed:${DELIVERY}`,
    });
  });

  it("records a short receipt as a discrepancy and raises the event A3 consumes", async () => {
    const result = await confirmReceipt(
      sap(),
      context(),
      DELIVERY,
      { receiptDate: TODAY, lines: [{ lineNo: 10, receivedQty: 140 }], notes: "2 crates damaged" },
      { today: TODAY },
    );

    expect(result.pod.outcome).toBe("discrepancy");
    expect(result.discrepancy.differences[0]).toMatchObject({ difference: -10, short: true });

    const events = await runWithTenant(tenantA.id, () => db.outboxEvent.findMany());
    expect(events).toHaveLength(1);
    expect(events[0]?.eventName).toBe("delivery.discrepancy.reported");

    const payload = events[0]?.payload as {
      reason: string;
      salesOrder: string;
      notes?: string;
      lines: unknown[];
    };
    // The worker must not need a SAP read to understand its own event.
    expect(payload.salesOrder).toBe("0000004712");
    expect(payload.reason).toContain("received 140 M of 150 dispatched");
    expect(payload.notes).toBe("2 crates damaged");
    expect(payload.lines).toHaveLength(1);
  });

  it("treats the button as advisory: editing quantities down is a discrepancy", async () => {
    // Doc 05 draws two buttons, but which one *happened* is decided by the
    // numbers — the portal records what is true, not what was clicked.
    const result = await confirmReceipt(
      sap(),
      context(),
      DELIVERY,
      { receiptDate: TODAY, lines: [{ lineNo: 10, receivedQty: 149 }] },
      { today: TODAY },
    );

    expect(result.pod.outcome).toBe("discrepancy");
  });

  it("stores nothing when SAP refuses the receipt", async () => {
    const adapter = sap();
    // 0080001901 is already signed for; SAP refuses a second POD.
    const error = await expectDeliveryError(() =>
      confirmReceipt(
        adapter,
        context(),
        "0080001901",
        { receiptDate: TODAY, lines: [{ lineNo: 10, receivedQty: 12 }] },
        { today: TODAY },
      ),
    );

    expect(error.code).toBe("not_allowed");

    // SAP goes first precisely so this is true: no signature is recorded for
    // a receipt SAP never accepted.
    const stored = await findPodConfirmation(tenantA.id, KUNNR, "0080001901");
    const events = await runWithTenant(tenantA.id, () => db.outboxEvent.findMany());
    expect(stored).toBeNull();
    expect(events).toEqual([]);
  });

  it("cannot record a second POD for the same delivery", async () => {
    const adapter = sap();
    await confirmReceipt(adapter, context(), DELIVERY, cleanReceipt, { today: TODAY });

    const error = await expectDeliveryError(() =>
      confirmReceipt(adapter, context(), DELIVERY, cleanReceipt, { today: TODAY }),
    );

    expect(error.code).toBe("not_allowed");
    const stored = await runWithTenant(tenantA.id, () => db.podConfirmation.findMany());
    expect(stored).toHaveLength(1);
  });

  it("answers 'already recorded' when the portal has a POD that SAP no longer does", async () => {
    // The two stores can disagree — a POD reversed in VL03N, a restored
    // database — and when they do the unique constraint is what stops a second
    // signature. It must read as the same refusal, not as a 500.
    await confirmReceipt(sap(), context(), DELIVERY, cleanReceipt, { today: TODAY });

    // A fresh adapter has no memory of the first POD, so SAP accepts again.
    const error = await expectDeliveryError(() =>
      confirmReceipt(sap(), context(), DELIVERY, cleanReceipt, { today: TODAY }),
    );

    expect(error.code).toBe("not_allowed");
    expect(error.status).toBe(409);
    const stored = await runWithTenant(tenantA.id, () => db.podConfirmation.findMany());
    expect(stored).toHaveLength(1);
  });

  it("404s another customer's delivery without touching SAP's state", async () => {
    const adapter = sap();
    const error = await expectDeliveryError(() =>
      confirmReceipt(adapter, context({ kunnr: OTHER_KUNNR }), DELIVERY, cleanReceipt, {
        today: TODAY,
      }),
    );

    expect(error.code).toBe("not_found");
    expect((await adapter.getDelivery(DELIVERY)).data.podConfirmed).toBeFalsy();
  });

  it("rejects a line number that isn't on the delivery", async () => {
    const error = await expectDeliveryError(() =>
      confirmReceipt(
        sap(),
        context(),
        DELIVERY,
        { receiptDate: TODAY, lines: [{ lineNo: 999, receivedQty: 1 }] },
        { today: TODAY },
      ),
    );

    expect(error.code).toBe("invalid");
    expect(error.issues[0]?.field).toBe("lines.999");
  });

  it("rejects a receipt dated before dispatch or in the future", async () => {
    const future = await expectDeliveryError(() =>
      confirmReceipt(
        sap(),
        context(),
        DELIVERY,
        { receiptDate: "2026-07-27", lines: [{ lineNo: 10, receivedQty: 150 }] },
        { today: TODAY },
      ),
    );
    expect(future.issues[0]?.message).toMatch(/future/);

    const early = await expectDeliveryError(() =>
      confirmReceipt(
        sap(),
        context(),
        DELIVERY,
        { receiptDate: "2026-07-01", lines: [{ lineNo: 10, receivedQty: 150 }] },
        { today: TODAY },
      ),
    );
    expect(early.issues[0]?.message).toMatch(/dispatched/);
  });

  it("does not let tenant B see tenant A's POD for the same delivery number", async () => {
    // SAP document numbers are unique only within one SAP system, so two
    // tenants can legitimately hold the same VBELN.
    await confirmReceipt(sap(), context(), DELIVERY, cleanReceipt, { today: TODAY });

    const asSeenByTenantB = await findPodConfirmation(tenantB.id, KUNNR, DELIVERY);
    expect(asSeenByTenantB).toBeNull();
  });

  it("shows the stored POD on the tracking screen once it exists", async () => {
    const adapter = sap();
    const before = await getDelivery(adapter, { tenantId: tenantA.id, kunnr: KUNNR }, DELIVERY);
    expect(before.pod).toBeNull();
    expect(before.podConfirmable).toBe(true);

    await confirmReceipt(
      adapter,
      context(),
      DELIVERY,
      { receiptDate: TODAY, lines: [{ lineNo: 10, receivedQty: 148 }], notes: "short by 2" },
      { today: TODAY },
    );

    const after = await getDelivery(adapter, { tenantId: tenantA.id, kunnr: KUNNR }, DELIVERY);
    expect(after.pod?.outcome).toBe("discrepancy");
    expect(after.pod?.notes).toBe("short by 2");
    // Signed for, so the screen must stop offering the POD form.
    expect(after.podConfirmable).toBe(false);
    expect(after.delivery.status).toBe("Delivered");
  });

  it("carries the e-way bill expectation for a consignment above the threshold", async () => {
    const detail = await getDelivery(sap(), { tenantId: tenantA.id, kunnr: KUNNR }, DELIVERY);

    expect(detail.ewayBillExpected).toBe(true);
    expect(detail.delivery.ewayBillNumber).toBe("291004901133");
    expect(detail.timeline).toHaveLength(5);
  });
});
