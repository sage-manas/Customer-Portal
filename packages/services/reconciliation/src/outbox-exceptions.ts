import { db, runWithTenant } from "@cc/db";
import { classifyOutboxException, type ReconciliationException } from "@cc/domain";

/**
 * Outbox exceptions (docs/07 B4's "stuck-outbox sweep").
 *
 * A separate package from `@cc/service-payment` on purpose: a service may
 * not import another service (CLAUDE.md rule 1, ADR-011, ADR-027), and this
 * module's only job is the half of B4 that has nothing to do with payments —
 * a row the relay has already given up on after `OUTBOX_MAX_ATTEMPTS`
 * (ADR-023). Nothing new is stored: `OutboxEvent.state` already carries
 * `failed`, added in A1 specifically "for docs/07 B4's exception tray".
 */

export interface OutboxException {
  id: string;
  eventName: string;
  queue: string;
  lastError: string | null;
  attempts: number;
  exception: ReconciliationException;
}

const OUTBOX_EXCEPTION_SELECT = {
  id: true,
  eventName: true,
  queue: true,
  state: true,
  lastError: true,
  attempts: true,
  occurredAt: true,
} as const;

/** Every outbox row in the tenant that has exhausted its relay attempts. */
export async function listOutboxExceptions(
  tenantId: string,
  now: Date = new Date(),
): Promise<OutboxException[]> {
  const rows = await runWithTenant(tenantId, () =>
    db.outboxEvent.findMany({
      where: { state: "failed" },
      orderBy: { occurredAt: "asc" },
      select: OUTBOX_EXCEPTION_SELECT,
    }),
  );

  const exceptions: OutboxException[] = [];
  for (const row of rows) {
    const classified = classifyOutboxException(row, now);
    if (!classified) continue;
    exceptions.push({
      id: row.id,
      eventName: row.eventName,
      queue: row.queue,
      lastError: row.lastError,
      attempts: row.attempts,
      exception: classified,
    });
  }
  return exceptions;
}

/**
 * Gives one failed row exactly one more shot, for the admin tray's manual
 * retry. It does not reset `attempts` — the relay's own attempts counter is
 * left to run out again on its own terms (`OUTBOX_MAX_ATTEMPTS`), so a row
 * that fails once more lands back in `failed` after a single try rather than
 * a fresh run of all five. Whatever caused the failure either resolved (the
 * row publishes and moves on) or it didn't (one attempt, back to `failed`,
 * still visible in the tray) — never a silent infinite retry loop.
 */
export async function requeueOutboxEvent(tenantId: string, eventId: string): Promise<boolean> {
  const result = await runWithTenant(tenantId, () =>
    db.outboxEvent.updateMany({
      where: { id: eventId, state: "failed" },
      data: { state: "pending", lastError: null },
    }),
  );
  return result.count > 0;
}

/**
 * The automatic half of the sweep (docs/07 B4 "nightly jobs... stuck-outbox
 * sweep"): every failed row past `cooldownMs` gets the same one-more-shot
 * `requeueOutboxEvent` gives a human-triggered retry, on the theory that
 * whatever the upstream failure was (a SAP or gateway outage, most often)
 * may have resolved since. The cooldown exists so a chronically broken event
 * is retried periodically rather than in a tight loop against a system that
 * is still down.
 */
export async function requeueStaleFailedOutboxEvents(
  tenantId: string,
  options: { now?: Date; cooldownMs?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const cooldownMs = options.cooldownMs ?? 30 * 60 * 1000;

  const result = await runWithTenant(tenantId, () =>
    db.outboxEvent.updateMany({
      where: { state: "failed", updatedAt: { lt: new Date(now.getTime() - cooldownMs) } },
      data: { state: "pending", lastError: null },
    }),
  );
  return result.count;
}
