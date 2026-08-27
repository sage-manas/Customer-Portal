/**
 * Frontend-only stand-in for `@cc/service-reconciliation` — the outbox half
 * of the AP desk's exception tray (docs/07 B4).
 *
 * The outbox is a backend construct end to end: rows are written in the same
 * transaction as the business change and drained by @cc/workers. Nothing in
 * the frontend produces one, so the demo store starts empty and the tray
 * renders its (correct, and reassuring) empty state.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-reconciliation (the `OutboxEvent` table
 * and the requeue path).
 */

import { classifyOutboxException, type ReconciliationException } from "@cc/domain";

import { demoStore } from "./_demo";

export interface OutboxException {
  id: string;
  eventName: string;
  queue: string;
  lastError: string | null;
  attempts: number;
  exception: ReconciliationException;
}

const outbox = () => demoStore().outboxExceptions as OutboxException[];

export async function listOutboxExceptions(
  _tenantId: string,
  _now?: Date,
): Promise<OutboxException[]> {
  return outbox();
}

export async function requeueOutboxEvent(_tenantId: string, id: string): Promise<OutboxException> {
  const row = outbox().find((event) => event.id === id);
  if (!row) {
    throw new Error("We couldn't find that event.");
  }
  // TODO(BACKEND):
  // The real requeue resets `attempts` and hands the row back to the worker
  // queue. There is no worker in demo mode, so the row is simply cleared.
  demoStore().outboxExceptions = outbox().filter((event) => event.id !== id);
  return row;
}

export async function requeueStaleFailedOutboxEvents(): Promise<number> {
  return 0;
}

export { classifyOutboxException };
