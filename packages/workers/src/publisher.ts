import type { DomainEventName, EventQueue } from "@cc/domain";
import { EVENT_QUEUES } from "@cc/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "./env";

/**
 * The queue side of the relay (docs/DECISIONS.md ADR-023).
 *
 * `EventPublisher` is an interface rather than "just call BullMQ" for the
 * same reason every external system in this repo has one: it lets the relay's
 * semantics — claiming, marking, republishing after a crash — be tested
 * against a fake without standing up a broker, and it keeps the BullMQ
 * import in exactly one file.
 */

/** What the relay hands to a queue. Deliberately flat and serialisable. */
export interface EventJob {
  /** Outbox row id. Used as the BullMQ job id, which is what makes an
   *  at-least-once republication a no-op on the queue side. */
  id: string;
  tenantId: string;
  eventName: DomainEventName;
  payload: unknown;
  occurredAt: Date;
}

export interface EventPublisher {
  publish(queue: EventQueue, job: EventJob): Promise<void>;
  close(): Promise<void>;
}

/**
 * A shared ioredis connection for BullMQ.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ's blocking commands, and
 * it is the right behaviour here anyway: a worker that gives up on Redis
 * mid-command would leave the outbox row claimed with nothing to unclaim it.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function createQueues(connection: Redis): Record<EventQueue, Queue> {
  const entries = EVENT_QUEUES.map((name) => [
    name,
    new Queue(name, {
      connection,
      defaultJobOptions: {
        // Handlers are idempotent by contract (ADR-023), so retrying is
        // always safe; backoff keeps a broken downstream from being hammered.
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600, count: 1000 },
        // Failures are kept: they are the raw material of B4's exception tray.
        removeOnFail: false,
      },
    }),
  ]);

  return Object.fromEntries(entries) as Record<EventQueue, Queue>;
}

export function createBullPublisher(connection: Redis): EventPublisher {
  const queues = createQueues(connection);

  return {
    async publish(queue, job) {
      await queues[queue].add(job.eventName, job, {
        // The outbox row id as the job id: a relay that crashed between
        // publishing and marking republishes the same row, and BullMQ drops
        // the second copy on its own.
        jobId: job.id,
      });
    },
    async close() {
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
    },
  };
}
