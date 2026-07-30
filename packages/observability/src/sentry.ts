import * as Sentry from "@sentry/node";

import { env } from "./env";

/**
 * Error reporting. `initErrorReporting()` is a no-op without `SENTRY_DSN` —
 * a tenant/deploy that hasn't configured Sentry yet must not crash on
 * startup, the same "additive, never a precondition" rule `env.ts` states.
 * `tracesSampleRate: 0` because OpenTelemetry (`tracing.ts`) already owns
 * distributed tracing; wiring both to sample spans would double-report.
 */
let initialized = false;

export function initErrorReporting(): void {
  if (initialized || !env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: 0,
  });
  initialized = true;
}

/** A no-op, not a throw, when Sentry isn't configured — see `initErrorReporting`. */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}

export function isErrorReportingInitialized(): boolean {
  return initialized;
}
