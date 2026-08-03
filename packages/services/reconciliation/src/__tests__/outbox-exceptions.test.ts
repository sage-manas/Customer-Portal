import { randomUUID } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listOutboxExceptions,
  requeueOutboxEvent,
  requeueStaleFailedOutboxEvents,
} from "../outbox-exceptions";

/**
 * Outbox exceptions against a real database (docs/07 B4): a row already in
 * `failed` — the state A1 added specifically for this tray — is what
 * `listOutboxExceptions` surfaces and what a retry moves back to `pending`.
 * Requires Postgres (see the package README).
 */

describe("outbox exceptions", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, () => db.outboxEvent.deleteMany());
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `recon-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `recon-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  async function makeFailedRow(
    tenantId: string,
    overrides: { occurredAt?: Date; updatedAt?: Date } = {},
  ) {
    return runWithTenant(tenantId, () =>
      db.outboxEvent.create({
        data: {
          tenantId,
          eventName: "payment.captured",
          payload: { occurredAt: new Date().toISOString(), paymentId: "pay_1" },
          queue: "payments",
          dedupeKey: randomUUID(),
          state: "failed",
          attempts: 5,
          lastError: "SAP unreachable",
          occurredAt: overrides.occurredAt ?? new Date(),
          ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
        },
      }),
    );
  }

  it("surfaces a failed row and nothing else", async () => {
    const failed = await makeFailedRow(tenantA.id);
    await runWithTenant(tenantA.id, () =>
      db.outboxEvent.create({
        data: {
          tenantId: tenantA.id,
          eventName: "payment.posted",
          payload: { occurredAt: new Date().toISOString(), paymentId: "pay_2" },
          queue: "payments",
          dedupeKey: randomUUID(),
          state: "pending",
          occurredAt: new Date(),
        },
      }),
    );

    const exceptions = await listOutboxExceptions(tenantA.id);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.id).toBe(failed.id);
    expect(exceptions[0]?.exception.kind).toBe("outbox_event_failed");
  });

  it("does not leak another tenant's failed rows", async () => {
    await makeFailedRow(tenantB.id);
    expect(await listOutboxExceptions(tenantA.id)).toHaveLength(0);
  });

  it("requeueOutboxEvent moves a failed row back to pending, once", async () => {
    const failed = await makeFailedRow(tenantA.id);

    const requeued = await requeueOutboxEvent(tenantA.id, failed.id);
    expect(requeued).toBe(true);

    const row = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: failed.id } }),
    );
    expect(row.state).toBe("pending");
    expect(row.lastError).toBeNull();

    // A row that isn't `failed` can't be requeued again.
    expect(await requeueOutboxEvent(tenantA.id, failed.id)).toBe(false);
  });

  it("requeueStaleFailedOutboxEvents only touches rows past the cooldown", async () => {
    const now = new Date();
    const stale = await makeFailedRow(tenantA.id, {
      updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
    });
    const fresh = await makeFailedRow(tenantA.id, { updatedAt: now });

    const count = await requeueStaleFailedOutboxEvents(tenantA.id, {
      now,
      cooldownMs: 30 * 60 * 1000,
    });
    expect(count).toBe(1);

    const staleRow = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: stale.id } }),
    );
    const freshRow = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findUniqueOrThrow({ where: { id: fresh.id } }),
    );
    expect(staleRow.state).toBe("pending");
    expect(freshRow.state).toBe("failed");
  });
});
