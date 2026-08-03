// First import, before anything reads `process.env`: unlike the Next.js app,
// a bare Node process gets no .env loading for free.
import "dotenv/config";

import { captureException, getLogger, initErrorReporting, initTracing } from "@cc/observability";
import type { Worker } from "bullmq";

import { createQueueWorker } from "../consumer";
import { env } from "../env";
import { registeredQueues } from "../handlers";
import { createBullPublisher, createRedisConnection } from "../publisher";
import { startReconciliationLoop, type ReconciliationLoop } from "../reconciliation";
import { startRelayLoop, type RelayLoop } from "../relay";
import { startSlaSweepLoop, type SlaSweepLoop } from "../sla-sweep";

const logger = getLogger("worker");

/**
 * The worker process (docs/07 A1).
 *
 * One process runs all four parts — the outbox relay, the queue consumers,
 * the SLA sweep, and reconciliation — because at pilot scale separate
 * processes would be separate things to deploy and monitor for no benefit.
 * They are separate modules precisely so that splitting them later is a
 * change to this file and nothing else.
 *
 * The three loops are different in kind. The relay publishes facts that
 * services already wrote. The SLA sweep *discovers* a fact — a deadline
 * passed and nothing happened — that no transaction could have written
 * (ADR-029). Reconciliation *retries*: it asks each module for what it
 * already knows is stuck and gives it another try (docs/07 B4, ADR-044).
 *
 * Run with `pnpm --filter @cc/workers start` (needs DATABASE_URL and the
 * Redis from docker-compose.dev.yml).
 */

async function main(): Promise<void> {
  initTracing();
  initErrorReporting();

  const connection = createRedisConnection();
  const publisher = createBullPublisher(connection);

  const queues = registeredQueues();
  const workers: Worker[] = queues.map((queue) => createQueueWorker(queue, connection));

  const relay: RelayLoop = startRelayLoop({
    publisher,
    intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    onError: (error) => {
      logger.error({ err: error }, "outbox relay sweep failed");
      captureException(error);
    },
  });

  const slaSweep: SlaSweepLoop = startSlaSweepLoop({
    intervalMs: env.SLA_SWEEP_INTERVAL_MS,
    onError: (error) => {
      logger.error({ err: error }, "SLA sweep failed");
      captureException(error);
    },
  });

  const reconciliation: ReconciliationLoop = startReconciliationLoop({
    intervalMs: env.RECONCILIATION_INTERVAL_MS,
    onError: (error) => {
      logger.error({ err: error }, "reconciliation sweep failed");
      captureException(error);
    },
  });

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      logger.error(
        { err: error, jobId: job?.id ?? "?", jobName: job?.name ?? "?" },
        "queue job failed",
      );
      captureException(error, { jobId: job?.id, jobName: job?.name });
    });
  }

  logger.info(
    {
      outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      slaSweepIntervalMs: env.SLA_SWEEP_INTERVAL_MS,
      reconciliationIntervalMs: env.RECONCILIATION_INTERVAL_MS,
      queues,
    },
    queues.length > 0 ? "worker started" : "worker started (no queues — no handlers registered)",
  );

  // Graceful shutdown: stop the relay first so nothing new is claimed, then
  // let in-flight jobs finish. A relay killed mid-publish is safe (the row
  // stays claimed and is reclaimed by the next sweep), but there is no reason
  // to make the next process clean up after this one.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    await relay.stop();
    await slaSweep.stop();
    await reconciliation.stop();
    await Promise.all(workers.map((worker) => worker.close()));
    await publisher.close();
    await connection.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "worker failed to start");
  captureException(error);
  process.exit(1);
});
