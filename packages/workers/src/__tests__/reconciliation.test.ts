import { randomUUID } from "node:crypto";

import { MockPaymentGateway } from "@cc/adapter-payment";
import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { handleGatewayWebhook, initiatePayment, listPendingSync } from "@cc/service-payment";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { reconcileOnce } from "../reconciliation";

/**
 * The reconciliation sweep end to end (docs/07 B4, ADR-044): a payment stuck
 * `captured` because SAP was down when its webhook arrived gets its posting
 * retried, and a failed outbox row past its cooldown gets one more shot at
 * the relay. Requires Postgres — see the package README.
 *
 * The tenant's own SAP/gateway drivers are resolved by `reconcileOnce` itself
 * (`getSapAdapterForTenant`/`getPaymentGatewayForTenant`), which is why this
 * test — unlike the payment package's own suite — never constructs a
 * `MockSapAdapter` for the retry: it seeds the *webhook* delivery with one
 * that is briefly unavailable, and lets reconciliation reach the tenant's
 * default (available) mock driver on its own.
 */

const KUNNR = "0010001001";
/** Seeded: overdue, 143252 outstanding. */
const OVERDUE_INVOICE = "0090002190";

describe("reconciliation sweep", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

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
    tenantA = await db.tenant.create({ data: { slug: `recon-wrk-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `recon-wrk-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  it("retries a captured payment's posting once it is stale enough", async () => {
    const gateway = new MockPaymentGateway();
    const initiated = await initiatePayment(
      tenantA.id,
      KUNNR,
      { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 143252 }] },
      { sap: new MockSapAdapter(), gateway },
    );

    // Deliver the webhook while SAP happens to be unreachable — the capture
    // is recorded, the posting isn't (ADR-019).
    const { body, signature } = gateway.buildWebhook(initiated.gatewayReference);
    await handleGatewayWebhook(tenantA.id, body, signature, {
      sap: new MockSapAdapter({ unavailable: true }),
      gateway,
    }).catch(() => undefined);

    expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(1);

    const result = await reconcileOnce({ now: new Date(Date.now() + 20 * 60 * 1000) });

    expect(result.paymentsRetried).toBeGreaterThanOrEqual(1);
    expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(0);
  });

  it("does not retry a payment that isn't stale enough yet", async () => {
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

    await reconcileOnce();

    // Same reason as the outbox case below: `paymentsRetried` counts every
    // tenant in the database, so `toBe(0)` was asserting that no *other*
    // suite had left a stale capture behind — a fact this test has no
    // opinion about and no control over. What it means to assert is that
    // this payment is still pending, which is what `listPendingSync` says.
    expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(1);
  });

  it("requeues a stale failed outbox row and leaves a fresh one alone", async () => {
    const now = new Date();
    const stale = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.create({
        data: {
          tenantId: tenantA.id,
          eventName: "payment.captured",
          payload: { occurredAt: now.toISOString(), paymentId: "pay_stale" },
          queue: "payments",
          dedupeKey: randomUUID(),
          state: "failed",
          attempts: 5,
          occurredAt: now,
          updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
        },
      }),
    );
    const fresh = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.create({
        data: {
          tenantId: tenantA.id,
          eventName: "payment.captured",
          payload: { occurredAt: now.toISOString(), paymentId: "pay_fresh" },
          queue: "payments",
          dedupeKey: randomUUID(),
          state: "failed",
          attempts: 5,
          occurredAt: now,
          updatedAt: now,
        },
      }),
    );

    await reconcileOnce({ now });

    // Deliberately not `expect(result.outboxRequeued).toBe(1)`. The sweep is
    // cross-tenant by design (ADR-044), so its counters describe the whole
    // database, not this suite's two tenants — a stale failed row left by
    // any other integration suite makes an exact count wrong, and the whole
    // point of the test is which of *these two* rows moved. That is what the
    // reads below assert, and they are strictly stronger than the counter.
    const staleRow = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: stale.id } }),
    );
    const freshRow = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: fresh.id } }),
    );
    expect(staleRow.state).toBe("pending");
    expect(freshRow.state).toBe("failed");
  });

  it("keeps each tenant's reconciliation to itself", async () => {
    const gateway = new MockPaymentGateway();
    const initiated = await initiatePayment(
      tenantB.id,
      KUNNR,
      { mode: "upi", allocations: [{ documentNumber: OVERDUE_INVOICE, amount: 143252 }] },
      { sap: new MockSapAdapter(), gateway },
    );
    const { body, signature } = gateway.buildWebhook(initiated.gatewayReference);
    await handleGatewayWebhook(tenantB.id, body, signature, {
      sap: new MockSapAdapter({ unavailable: true }),
      gateway,
    }).catch(() => undefined);

    await reconcileOnce({ now: new Date(Date.now() + 20 * 60 * 1000) });

    // Tenant A never had anything stuck; tenant B's own posting is what
    // actually got retried.
    expect(await listPendingSync(tenantA.id, KUNNR)).toHaveLength(0);
    expect(await listPendingSync(tenantB.id, KUNNR)).toHaveLength(0);
  });
});
