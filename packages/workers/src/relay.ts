import { db, runWithTenant } from "@cc/db";
import { isDomainEventName, parseEventPayload, type EventQueue } from "@cc/domain";

import { env } from "./env";
import type { EventPublisher } from "./publisher";

/**
 * The outbox relay (docs/DECISIONS.md ADR-023).
 *
 * The only process that publishes to BullMQ. Its contract is deliberately
 * **at-least-once**: it claims a batch, publishes, then marks the rows
 * published, and a crash in between republishes. The alternative ordering —
 * mark first, then publish — would be at-most-once and would silently drop
 * an event whenever the process died at the wrong moment, which for a
 * dispatch notification means a customer who is never told their goods
 * shipped. Duplicates are handled instead: the BullMQ job id is the outbox
 * row id, and handlers are idempotent by contract.
 *
 * Tenancy: the relay never queries the outbox unscoped. It lists tenants
 * (`Tenant` is not a tenant-owned model) and sweeps each inside
 * `runWithTenant`, so the scoping extension applies to every read and write
 * exactly as it does on the request path.
 */

export interface RelayOptions {
  publisher: EventPublisher;
  /** Rows per tenant per sweep. Defaults to `OUTBOX_BATCH_SIZE`. */
  batchSize?: number;
  /** Attempts before a row is parked in `failed`. Defaults to `OUTBOX_MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /**
   * How long a row may sit in `publishing` before another sweep assumes the
   * relay that claimed it died and takes it back. Must comfortably exceed a
   * normal publish; the cost of being wrong is a duplicate, not a loss.
   */
  reclaimAfterMs?: number;
  /** Injectable for tests. */
  now?: () => Date;
}

export interface RelayResult {
  claimed: number;
  published: number;
  failed: number;
  /** Rows taken back from a relay that appears to have died mid-publish. */
  reclaimed: number;
}

const emptyResult = (): RelayResult => ({ claimed: 0, published: 0, failed: 0, reclaimed: 0 });

/**
 * One sweep for one tenant. Exported because the integration suite drives it
 * directly, and because a future admin action ("retry this tenant's outbox")
 * wants exactly this and not the loop around it.
 */
export async function relayTenant(tenantId: string, options: RelayOptions): Promise<RelayResult> {
  const batchSize = options.batchSize ?? env.OUTBOX_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? env.OUTBOX_MAX_ATTEMPTS;
  const reclaimAfterMs = options.reclaimAfterMs ?? 60_000;
  const now = options.now ?? (() => new Date());

  const result = emptyResult();

  await runWithTenant(tenantId, async () => {
    // 1. Take back anything a dead relay left claimed. Doing this before the
    //    claim means a crashed sweep heals on the next tick rather than
    //    stranding its rows until someone notices.
    const reclaimed = await db.outboxEvent.updateMany({
      where: {
        state: "publishing",
        updatedAt: { lt: new Date(now().getTime() - reclaimAfterMs) },
      },
      data: { state: "pending" },
    });
    result.reclaimed = reclaimed.count;

    // 2. Claim a batch. Two statements rather than one because Prisma has no
    //    `UPDATE ... RETURNING` on `updateMany`; the `state: "pending"` guard
    //    on the update is what makes the claim safe if two relays race —
    //    the loser updates zero rows and re-reads nothing it owns.
    const candidates = await db.outboxEvent.findMany({
      where: { state: "pending" },
      orderBy: { occurredAt: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (candidates.length === 0) return;

    const ids = candidates.map((row) => row.id);
    const claim = await db.outboxEvent.updateMany({
      where: { id: { in: ids }, state: "pending" },
      data: { state: "publishing" },
    });
    if (claim.count === 0) return;

    const rows = await db.outboxEvent.findMany({
      where: { id: { in: ids }, state: "publishing" },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        eventName: true,
        payload: true,
        queue: true,
        occurredAt: true,
        attempts: true,
      },
    });
    result.claimed = rows.length;

    for (const row of rows) {
      try {
        // Validated again here, not only at the producer: an outbox row can
        // outlive a deploy, so a worker may be reading events an older
        // version of the schema wrote. Better a loud failed row than a
        // handler handed a shape it doesn't expect.
        if (!isDomainEventName(row.eventName)) {
          throw new Error(`Unknown event "${row.eventName}" — not in the @cc/domain registry`);
        }
        const payload = parseEventPayload(row.eventName, row.payload);

        await options.publisher.publish(row.queue as EventQueue, {
          id: row.id,
          tenantId,
          eventName: row.eventName,
          payload,
          occurredAt: row.occurredAt,
        });

        await db.outboxEvent.update({
          where: { id: row.id },
          data: { state: "published", publishedAt: now(), lastError: null },
        });
        result.published += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const exhausted = attempts >= maxAttempts;

        await db.outboxEvent.update({
          where: { id: row.id },
          data: {
            // Exhausted rows park in `failed` so an operator can list them
            // (docs/07 B4); everything else goes back to `pending` for the
            // next sweep.
            state: exhausted ? "failed" : "pending",
            attempts,
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
        if (exhausted) result.failed += 1;
      }
    }
  });

  return result;
}

/** One sweep across every tenant. */
export async function relayOnce(options: RelayOptions): Promise<RelayResult> {
  const tenants = await db.tenant.findMany({ select: { id: true } });

  const total = emptyResult();
  for (const tenant of tenants) {
    // Sequential, not `Promise.all`: the relay shares one connection pool
    // with the request path, and a hundred tenants sweeping at once is a
    // self-inflicted outage on the app, not throughput.
    const result = await relayTenant(tenant.id, options);
    total.claimed += result.claimed;
    total.published += result.published;
    total.failed += result.failed;
    total.reclaimed += result.reclaimed;
  }
  return total;
}

export interface RelayLoop {
  stop(): Promise<void>;
}

/**
 * Runs `relayOnce` on an interval until stopped.
 *
 * Polling rather than a Postgres `LISTEN`: the tick is the thing that also
 * retries a failed publish and reclaims a dead relay's rows, so the loop has
 * to exist regardless, and a notification would only shave a second or two
 * off the happy path in exchange for a second failure mode.
 */
export function startRelayLoop(
  options: RelayOptions & { intervalMs?: number; onError?: (error: unknown) => void },
): RelayLoop {
  const intervalMs = options.intervalMs ?? env.OUTBOX_POLL_INTERVAL_MS;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    try {
      await relayOnce(options);
    } catch (error) {
      // A sweep that throws (Redis down, Postgres blipped) must not kill the
      // loop — the rows are still in the outbox and the next tick retries.
      options.onError?.(error);
    }
  };

  const timer = setInterval(() => {
    running = running.then(tick);
  }, intervalMs);
  // Don't hold the process open on the timer alone.
  timer.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
