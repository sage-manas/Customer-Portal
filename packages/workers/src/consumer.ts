import { isDomainEventName, parseEventPayload, type EventQueue } from "@cc/domain";
import { Worker } from "bullmq";
import type { Redis } from "ioredis";

import { env } from "./env";
import { dispatchEvent } from "./handlers";
import type { EventJob } from "./publisher";

/**
 * The consuming half: a BullMQ `Worker` per queue that looks each job's
 * handlers up in the registry and runs them.
 *
 * There is no `switch` on the event name anywhere in this file, and there
 * shouldn't be one in any file that follows — adding a consumer means calling
 * `registerHandler`, not editing this loop (CLAUDE.md rule 3).
 */
export function createQueueWorker(queue: EventQueue, connection: Redis): Worker {
  return new Worker(
    queue,
    async (job) => {
      const data = job.data as EventJob;

      if (!isDomainEventName(data.eventName)) {
        // An event this build doesn't know about — most likely a rollback
        // with jobs already in flight. Failing is right: a newer worker will
        // pick it up on retry, and the job is kept for the exception tray.
        throw new Error(`Unknown event "${data.eventName}" — not in the @cc/domain registry`);
      }

      const payload = parseEventPayload(data.eventName, data.payload);

      await dispatchEvent(data.eventName, payload, {
        tenantId: data.tenantId,
        eventId: data.id,
      });
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );
}
