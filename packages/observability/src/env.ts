import { z } from "zod";

/**
 * Zod-validated environment for observability config, mirroring
 * `apps/web/lib/env.ts` and `packages/workers/src/env.ts`. Every field is
 * optional or defaulted: a tenant/deploy that sets none of these still runs
 * — logs go to stdout, traces go nowhere (the OTel API's own no-op tracer),
 * and Sentry stays uninitialized. Observability is additive, never a
 * precondition for the app to start (docs/07 B3).
 */
const schema = z.object({
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Identifies this process in logs, traces and Sentry. */
  OTEL_SERVICE_NAME: z.string().default("customer-portal"),
  /** OTLP/HTTP traces endpoint. Unset in local dev: spans print to the console instead. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),
});

export type ObservabilityEnv = z.infer<typeof schema>;

let cached: ObservabilityEnv | undefined;

function parseEnv(): ObservabilityEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    LOG_LEVEL: process.env.LOG_LEVEL,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
    SENTRY_DSN: process.env.SENTRY_DSN || undefined,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid observability environment configuration:\n${issues.join("\n")}`);
  }

  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as ObservabilityEnv, {
  get: (_target, property: string) => parseEnv()[property as keyof ObservabilityEnv],
});
