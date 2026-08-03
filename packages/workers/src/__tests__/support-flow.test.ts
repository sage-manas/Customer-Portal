import { randomUUID } from "node:crypto";

import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type { EventQueue } from "@cc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "../handlers/support-auto-ticket";
import { dispatchEvent } from "../handlers/registry";
import type { EventJob, EventPublisher } from "../publisher";
import { relayTenant } from "../relay";
import { sweepSlaOnce } from "../sla-sweep";

/**
 * A2 → A3 end to end against a real database: the POD discrepancy event that
 * ADR-026 wrote in the delivery transaction, through the relay, into the
 * support ticket docs/05 §7.5 promises — plus the SLA sweep, which is the
 * other half of A3's async surface.
 *
 * Redis is deliberately absent, as in the relay suite: the publisher is an
 * interface, and dispatching a handler needs no broker. Requires Postgres —
 * see the package README.
 */

function fakePublisher(): EventPublisher & {
  published: Array<{ queue: EventQueue; job: EventJob }>;
} {
  const published: Array<{ queue: EventQueue; job: EventJob }> = [];
  return {
    published,
    async publish(queue, job) {
      published.push({ queue, job });
    },
    async close() {},
  };
}

const KUNNR = "0010001001";

const discrepancy = (vbeln: string) => ({
  occurredAt: new Date(),
  kunnr: KUNNR,
  documentNumber: vbeln,
  salesOrder: "0000004712",
  reason: "MAT-20002: received 140 M of 150 dispatched",
  reportedByUserId: "user_buyer",
  notes: "Two pallets arrived water-damaged.",
  lines: [{ lineNo: 10, material: "MAT-20002", dispatchedQty: 150, receivedQty: 140 }],
});

describe("POD discrepancy raises a support ticket", () => {
  const runId = randomUUID().slice(0, 8);
  let tenant: { id: string };

  async function wipe() {
    await runWithTenant(tenant.id, async () => {
      await db.ticketAttachment.deleteMany();
      await db.ticketComment.deleteMany();
      await db.supportTicket.deleteMany();
      await db.ticketCounter.deleteMany();
      await db.outboxEvent.deleteMany();
    });
  }

  beforeAll(async () => {
    tenant = await db.tenant.create({ data: { slug: `wk-sup-${runId}`, name: "Tenant" } });
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: tenant.id } });
    await db.$disconnect();
  });

  it("routes the discrepancy to the workflow queue and raises a Delivery ticket", async () => {
    await runWithTenant(tenant.id, () =>
      writeOutboxEvent(db, {
        name: "delivery.discrepancy.reported",
        payload: discrepancy("0080001947"),
        dedupeKey: "delivery.discrepancy.reported:0080001947",
      }),
    );

    const publisher = fakePublisher();
    await relayTenant(tenant.id, { publisher });

    // The registry routes it — no switch in the relay or the consumer.
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.queue).toBe("workflow");

    const job = publisher.published[0]!.job;
    await dispatchEvent("delivery.discrepancy.reported", job.payload as never, {
      tenantId: tenant.id,
      eventId: job.id,
    });

    const ticket = await runWithTenant(tenant.id, () =>
      db.supportTicket.findFirst({
        select: { category: true, priority: true, relatedDocNumber: true, ticketNo: true },
      }),
    );

    expect(ticket).toMatchObject({
      category: "delivery",
      priority: "high",
      relatedDocNumber: "0080001947",
      ticketNo: "TKT-000001",
    });
  });

  it("raises exactly one ticket when the relay is at-least-once", async () => {
    const payload = discrepancy("0080001948");

    // ADR-023: a crash between publish and mark republishes, so a handler
    // *will* see the same event twice. One delivery, one ticket.
    await dispatchEvent("delivery.discrepancy.reported", payload, {
      tenantId: tenant.id,
      eventId: "evt_1",
    });
    await dispatchEvent("delivery.discrepancy.reported", payload, {
      tenantId: tenant.id,
      eventId: "evt_1",
    });

    const count = await runWithTenant(tenant.id, () => db.supportTicket.count());
    expect(count).toBe(1);
  });

  it("announces the auto-raised ticket on the outbox like any other", async () => {
    await dispatchEvent("delivery.discrepancy.reported", discrepancy("0080001949"), {
      tenantId: tenant.id,
      eventId: "evt_2",
    });

    const events = await runWithTenant(tenant.id, () =>
      db.outboxEvent.findMany({ select: { eventName: true } }),
    );
    // The auto path goes through the same code as the customer's form, so the
    // notification A7 will send is produced without A7 knowing which raised it.
    expect(events.map((e) => e.eventName)).toEqual(["support.ticket.created"]);
  });

  it("sweeps a breached ticket into an outbox event, once", async () => {
    await dispatchEvent("delivery.discrepancy.reported", discrepancy("0080001950"), {
      tenantId: tenant.id,
      eventId: "evt_3",
    });

    // `high` is an 8-hour SLA; drag the ticket back beyond it.
    await runWithTenant(tenant.id, () =>
      db.supportTicket.updateMany({
        data: { openedAt: new Date(Date.now() - 9 * 60 * 60 * 1000) },
      }),
    );

    expect(await sweepSlaOnce()).toMatchObject({ breaches: 1 });
    expect(await sweepSlaOnce()).toMatchObject({ breaches: 0 });

    const breaches = await runWithTenant(tenant.id, () =>
      db.outboxEvent.findMany({ where: { eventName: "support.sla.breached" } }),
    );
    expect(breaches).toHaveLength(1);
  });
});
