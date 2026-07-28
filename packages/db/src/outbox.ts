import { DOMAIN_EVENTS, parseEventPayload, type DomainEventName } from "@cc/domain";

import { db, type Db } from "./client";
import { getTenantId } from "./tenant-context";

/**
 * Writing to the transactional outbox (docs/DECISIONS.md ADR-023).
 *
 * This lives in `@cc/db` rather than in a service because *every* service
 * needs it and a service may not import another service (ADR-011). It is
 * deliberately the only way to produce an event: nothing in the codebase
 * outside `@cc/workers` may touch BullMQ, so a service that wants an effect
 * elsewhere writes a row here, inside the transaction that made the effect
 * true.
 *
 * The relay side lives in `@cc/workers` — this file only writes.
 */

/**
 * A Prisma transaction client. Typed structurally rather than as Prisma's
 * `TransactionClient` because that type is generated per-schema and would
 * force every caller to import the generated namespace just to type a
 * parameter; all we need is the one delegate we use.
 */
export type OutboxWriter = Pick<Db, "outboxEvent">;

export interface OutboxEventInput<N extends DomainEventName = DomainEventName> {
  name: N;
  payload: unknown;
  /**
   * Producer-side idempotency key (ADR-023). Two writes with the same key in
   * a tenant produce one event. Make it describe the *cause* — the payment
   * id and the event, the delivery and the discrepancy — never a timestamp
   * or a random value, or it dedupes nothing.
   */
  dedupeKey: string;
}

/**
 * Records a domain event.
 *
 * Pass the transaction client from the `db.$transaction(...)` that is making
 * the state change; passing the plain `db` writes it in its own transaction,
 * which is only correct when there is no state change to be atomic with (a
 * pure notification, say). The payload is validated against the event's
 * registered schema here, so a malformed event fails at the producer with a
 * stack trace pointing at the bug rather than in a worker hours later.
 *
 * Returns the row id, which the relay uses as the BullMQ job id — so the
 * queue collapses the obvious duplicates without the relay tracking anything.
 * Returns `undefined` when the event already existed for this dedupe key.
 */
export async function writeOutboxEvent<N extends DomainEventName>(
  client: OutboxWriter,
  event: OutboxEventInput<N>,
): Promise<string | undefined> {
  const payload = parseEventPayload(event.name, event.payload);
  const tenantId = getTenantId();

  // `createMany` + skipDuplicates rather than a catch on the unique
  // constraint: inside a transaction, a caught constraint violation still
  // aborts the surrounding transaction in Postgres, which would roll back the
  // very state change this event describes. A duplicate event must be a
  // no-op, not a failed business operation.
  const created = await client.outboxEvent.createMany({
    data: [
      {
        tenantId,
        eventName: event.name,
        payload: payload as object,
        queue: DOMAIN_EVENTS[event.name].queue,
        dedupeKey: event.dedupeKey,
        occurredAt: (payload as { occurredAt: Date }).occurredAt,
      },
    ],
    skipDuplicates: true,
  });

  if (created.count === 0) return undefined;

  const row = await client.outboxEvent.findFirst({
    where: { dedupeKey: event.dedupeKey },
    select: { id: true },
  });

  return row?.id;
}

/**
 * Convenience for the no-transaction case, so a caller with nothing to be
 * atomic with doesn't have to reach for the client itself.
 */
export function recordEvent<N extends DomainEventName>(
  event: OutboxEventInput<N>,
): Promise<string | undefined> {
  return writeOutboxEvent(db, event);
}
