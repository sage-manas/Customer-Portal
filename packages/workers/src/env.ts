import { z } from "zod";

/**
 * Zod-validated environment for the worker process, mirroring
 * `apps/web/lib/env.ts` — fail with a readable message rather than at 2am
 * with `undefined is not a string`.
 *
 * Validation is lazy for the same reason it is in the app: a build machine
 * legitimately has no runtime secrets, and anything that actually reads a
 * value does so once the process is running.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  /** The Redis from docker-compose.dev.yml; BullMQ's broker. */
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  /** How often the relay sweeps the outbox, in milliseconds. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  /** Rows claimed per tenant per sweep. Bounds one slow tenant's blast radius. */
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  /** Relay attempts before a row lands in `failed` for the exception tray. */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Jobs a single worker runs at once, per queue. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
});

export type WorkerEnv = z.infer<typeof schema>;

let cached: WorkerEnv | undefined;

function parseEnv(): WorkerEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    OUTBOX_POLL_INTERVAL_MS: process.env.OUTBOX_POLL_INTERVAL_MS,
    OUTBOX_BATCH_SIZE: process.env.OUTBOX_BATCH_SIZE,
    OUTBOX_MAX_ATTEMPTS: process.env.OUTBOX_MAX_ATTEMPTS,
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid worker environment configuration:\n${issues.join("\n")}`);
  }

  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as WorkerEnv, {
  get: (_target, property: string) => parseEnv()[property as keyof WorkerEnv],
});
