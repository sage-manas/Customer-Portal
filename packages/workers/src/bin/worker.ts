// First import, before anything reads `process.env`: unlike the Next.js app,
// a bare Node process gets no .env loading for free.
import "dotenv/config";

import type { Worker } from "bullmq";

import { createQueueWorker } from "../consumer";
import { env } from "../env";
import { registeredQueues } from "../handlers";
import { createBullPublisher, createRedisConnection } from "../publisher";
import { startRelayLoop, type RelayLoop } from "../relay";

/**
 * The worker process (docs/07 A1).
 *
 * One process runs both halves — the outbox relay and the queue consumers —
 * because at pilot scale two processes would be two things to deploy and
 * monitor for no benefit. They are separate modules precisely so that
 * splitting them later is a change to this file and nothing else.
 *
 * Run with `pnpm --filter @cc/workers start` (needs DATABASE_URL and the
 * Redis from docker-compose.dev.yml).
 */

async function main(): Promise<void> {
  const connection = createRedisConnection();
  const publisher = createBullPublisher(connection);

  const queues = registeredQueues();
  const workers: Worker[] = queues.map((queue) => createQueueWorker(queue, connection));

  const relay: RelayLoop = startRelayLoop({
    publisher,
    intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    onError: (error) => {
      console.error("[worker] outbox relay sweep failed", error);
    },
  });

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`[worker] job ${job?.id ?? "?"} (${job?.name ?? "?"}) failed:`, error.message);
    });
  }

  console.log(
    `[worker] relay every ${env.OUTBOX_POLL_INTERVAL_MS}ms; consuming ${
      queues.length > 0 ? queues.join(", ") : "(no queues — no handlers registered)"
    }`,
  );

  // Graceful shutdown: stop the relay first so nothing new is claimed, then
  // let in-flight jobs finish. A relay killed mid-publish is safe (the row
  // stays claimed and is reclaimed by the next sweep), but there is no reason
  // to make the next process clean up after this one.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} — shutting down`);
    await relay.stop();
    await Promise.all(workers.map((worker) => worker.close()));
    await publisher.close();
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[worker] failed to start", error);
  process.exit(1);
});
