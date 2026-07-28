import { randomUUID } from "node:crypto";

import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type { EventQueue } from "@cc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EventJob, EventPublisher } from "../publisher";
import { relayOnce, relayTenant } from "../relay";

/**
 * The outbox relay end to end against a real database (ADR-023): write in a
 * transaction, dedupe, claim → publish → mark, the crash-between-publish-and
 * -mark republication, the reclaim of a dead relay's rows, and the tenant
 * scoping of the relay's own reads.
 *
 * Redis is deliberately absent: the publisher is an interface, so the relay's
 * semantics are provable without a broker. Requires Postgres — see the
 * package README.
 */

/** Records what was published, and can be told to fail. */
function fakePublisher(): EventPublisher & {
  published: Array<{ queue: EventQueue; job: EventJob }>;
  failNext: (times: number) => void;
} {
  const published: Array<{ queue: EventQueue; job: EventJob }> = [];
  let failures = 0;

  return {
    published,
    failNext(times: number) {
      failures = times;
    },
    async publish(queue, job) {
      if (failures > 0) {
        failures -= 1;
        throw new Error("broker unavailable");
      }
      published.push({ queue, job });
    },
    async close() {},
  };
}

const capturedPayload = (paymentId: string) => ({
  occurredAt: new Date("2026-07-28T10:00:00.000Z"),
  paymentId,
  kunnr: "0010001001",
  amount: 1000,
  currency: "INR",
});

describe("outbox relay", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, () => db.outboxEvent.deleteMany());
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `wrk-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `wrk-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  it("writes an event with its registered queue and pending state", async () => {
    const id = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_1"),
        dedupeKey: "payment.captured:pay_1",
      }),
    );

    const row = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: id! } }),
    );

    expect(row.queue).toBe("reconciliation");
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0);
  });

  it("rejects a malformed payload at the producer, before anything is written", async () => {
    await expect(
      runWithTenant(tenantA.id, () =>
        writeOutboxEvent(db, {
          name: "payment.captured",
          // No amount — the registry's schema requires one.
          payload: { occurredAt: new Date(), paymentId: "pay_x", kunnr: "1", currency: "INR" },
          dedupeKey: "payment.captured:pay_x",
        }),
      ),
    ).rejects.toThrow();

    const count = await runWithTenant(tenantA.id, () => db.outboxEvent.count());
    expect(count).toBe(0);
  });

  it("dedupes a producer that runs twice, without failing the second caller", async () => {
    const first = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_2"),
        dedupeKey: "payment.captured:pay_2",
      }),
    );
    const second = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_2"),
        dedupeKey: "payment.captured:pay_2",
      }),
    );

    expect(first).toBeTruthy();
    // A duplicate is a no-op, not an error — a retried webhook must not fail
    // the business operation it is attached to.
    expect(second).toBeUndefined();
    expect(await runWithTenant(tenantA.id, () => db.outboxEvent.count())).toBe(1);
  });

  it("rolls the event back with the transaction that caused it", async () => {
    await expect(
      runWithTenant(tenantA.id, () =>
        db.$transaction(async (tx) => {
          await writeOutboxEvent(tx, {
            name: "payment.captured",
            payload: capturedPayload("pay_3"),
            dedupeKey: "payment.captured:pay_3",
          });
          throw new Error("the state change failed after the event was written");
        }),
      ),
    ).rejects.toThrow(/state change failed/);

    // The whole point of the transactional outbox: no event for a fact that
    // never became true.
    expect(await runWithTenant(tenantA.id, () => db.outboxEvent.count())).toBe(0);
  });

  it("publishes a pending row to its queue and marks it published", async () => {
    const id = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_4"),
        dedupeKey: "payment.captured:pay_4",
      }),
    );
    const publisher = fakePublisher();

    const result = await relayTenant(tenantA.id, { publisher });

    expect(result.published).toBe(1);
    expect(publisher.published).toHaveLength(1);

    const [entry] = publisher.published;
    expect(entry?.queue).toBe("reconciliation");
    expect(entry?.job.id).toBe(id);
    expect(entry?.job.tenantId).toBe(tenantA.id);

    const row = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: id! } }),
    );
    expect(row.state).toBe("published");
    expect(row.publishedAt).not.toBeNull();
  });

  it("does not publish the same row twice on a later sweep", async () => {
    await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_5"),
        dedupeKey: "payment.captured:pay_5",
      }),
    );
    const publisher = fakePublisher();

    await relayTenant(tenantA.id, { publisher });
    await relayTenant(tenantA.id, { publisher });

    expect(publisher.published).toHaveLength(1);
  });

  it("returns a row to pending when publishing fails, and retries it next sweep", async () => {
    await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_6"),
        dedupeKey: "payment.captured:pay_6",
      }),
    );
    const publisher = fakePublisher();
    publisher.failNext(1);

    const first = await relayTenant(tenantA.id, { publisher });
    expect(first.published).toBe(0);
    expect(first.failed).toBe(0);

    const afterFailure = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findFirstOrThrow({ where: { dedupeKey: "payment.captured:pay_6" } }),
    );
    expect(afterFailure.state).toBe("pending");
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toMatch(/broker unavailable/);

    const second = await relayTenant(tenantA.id, { publisher });
    expect(second.published).toBe(1);
  });

  it("parks a row in failed once its attempts are exhausted", async () => {
    await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_7"),
        dedupeKey: "payment.captured:pay_7",
      }),
    );
    const publisher = fakePublisher();
    publisher.failNext(2);

    await relayTenant(tenantA.id, { publisher, maxAttempts: 2 });
    const result = await relayTenant(tenantA.id, { publisher, maxAttempts: 2 });

    expect(result.failed).toBe(1);
    const row = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findFirstOrThrow({ where: { dedupeKey: "payment.captured:pay_7" } }),
    );
    // Listable for the operator exception tray (docs/07 B4), not spinning
    // forever against a broker that is clearly not coming back.
    expect(row.state).toBe("failed");
  });

  it("reclaims a row left claimed by a relay that died mid-publish", async () => {
    const id = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_8"),
        dedupeKey: "payment.captured:pay_8",
      }),
    );
    // Simulate the crash: the row is claimed and nothing ever finished it.
    await runWithTenant(tenantA.id, () =>
      db.outboxEvent.update({ where: { id: id! }, data: { state: "publishing" } }),
    );

    const publisher = fakePublisher();
    const result = await relayTenant(tenantA.id, {
      publisher,
      // Move the relay's clock forward rather than shrinking the window: the
      // row's `updatedAt` comes from Postgres, so a threshold a millisecond
      // either side of "now" races the database's own clock.
      now: () => new Date(Date.now() + 60 * 60 * 1000),
    });

    // At-least-once by design: the event is republished rather than stranded,
    // and the job id makes the duplicate a no-op on the queue side.
    expect(result.reclaimed).toBe(1);
    expect(result.published).toBe(1);
  });

  it("never publishes another tenant's events", async () => {
    await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_a"),
        dedupeKey: "payment.captured:pay_a",
      }),
    );
    await runWithTenant(tenantB.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_b"),
        dedupeKey: "payment.captured:pay_b",
      }),
    );

    const publisher = fakePublisher();
    await relayTenant(tenantA.id, { publisher });

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.job.tenantId).toBe(tenantA.id);

    // Tenant B's row is untouched — the relay's own reads are scoped exactly
    // as the request path's are.
    const rowB = await runWithTenant(tenantB.id, () =>
      db.outboxEvent.findFirstOrThrow({ where: { dedupeKey: "payment.captured:pay_b" } }),
    );
    expect(rowB.state).toBe("pending");
  });

  it("sweeps every tenant in relayOnce", async () => {
    await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_all_a"),
        dedupeKey: "payment.captured:pay_all_a",
      }),
    );
    await runWithTenant(tenantB.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: capturedPayload("pay_all_b"),
        dedupeKey: "payment.captured:pay_all_b",
      }),
    );

    const publisher = fakePublisher();
    const result = await relayOnce({ publisher });

    const tenants = publisher.published.map((entry) => entry.job.tenantId);
    expect(result.published).toBeGreaterThanOrEqual(2);
    expect(tenants).toContain(tenantA.id);
    expect(tenants).toContain(tenantB.id);
  });
});
