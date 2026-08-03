import pino from "pino";

import { getContext } from "./context";
import { env } from "./env";

/**
 * Structured logging. `pino`, not `console.*` — every previous ad hoc
 * `console.log`/`console.error` in the repo (`packages/workers/src/bin/worker.ts`,
 * the notification "log" driver) produced text nobody could query by
 * tenant or request; this is the replacement for the app and workers, kept
 * out of `apps/web/middleware.ts` deliberately (pino is Node-only, and
 * middleware runs on the edge runtime).
 *
 * Redaction is a contract-level property, not a per-call-site discipline:
 * ADR-042 named `credentialsRef`'s replacement — `credentials: Record<string,
 * string>` — as material that "must never be logged", and a config object
 * carrying it is exactly the kind of thing that ends up in a `logger.info({
 * config })` call by accident. The paths below catch it at any nesting depth
 * pino's redact syntax reaches, rather than trusting every future call site
 * to remember.
 */
const REDACT_PATHS = [
  "*.credentials",
  "*.credentials.*",
  "*.keySecret",
  "*.webhookSecret",
  "*.password",
  "*.token",
  "*.secret",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const rootLogger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.OTEL_SERVICE_NAME },
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  // Pulls the active request's correlation fields into every log line
  // without every call site passing them — the same "declared once, applied
  // everywhere" shape as the outbox event registry (ADR-023) or the
  // notification template registry (ADR-040), moved to logging.
  mixin() {
    const context = getContext();
    if (!context) return {};
    return {
      requestId: context.requestId,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.userId ? { userId: context.userId } : {}),
    };
  },
});

export function getLogger(name: string): pino.Logger {
  return rootLogger.child({ module: name });
}

export type Logger = pino.Logger;
