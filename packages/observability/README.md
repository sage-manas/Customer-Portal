# @cc/observability

Structured logging, request correlation, tracing, error reporting and edge-safe rate limiting — docs/07 B3, ADR-043.

## Purpose

Logging, tracing and error reporting are cross-cutting infrastructure, not a business-facing external system with tenant-visible behaviour, so this package does not follow the mock-first "driver behind an interface" shape CLAUDE.md rule 2 gives SAP, GSTN, storage, the payment gateway and the cache. `pino`, OpenTelemetry and Sentry are already the abstraction; wrapping them further would only add indirection. What the package does provide is the one thing this codebase always registers rather than hand-duplicates: a single place every service/adapter/route touches, so instrumentation does not need to be added at every call site by hand.

## What's here

- **`getLogger(name)`** — a `pino` child logger. Structured, not `console.*`; redacts credential-shaped fields (`credentials`, `keySecret`, `webhookSecret`, `password`, `token`, `secret`) at any nesting depth, because ADR-042's decrypted credential bags are exactly the kind of thing that ends up in a stray `logger.info({ config })`.
- **`runWithContext` / `getContext` / `setContextTenant`** — an `AsyncLocalStorage`-backed request context. Every log line's `mixin()` pulls `requestId`/`tenantId`/`userId` from it automatically, so call sites never pass correlation fields by hand. **Node-only** — never import this (or the package root) from `apps/web/middleware.ts`, which runs on the edge runtime.
- **`initTracing()` / `tracer`** — an OpenTelemetry `NodeSDK`, exporting to `OTEL_EXPORTER_OTLP_ENDPOINT` if set, otherwise to the console (so local dev sees spans, not silence). Safe to use even before `initTracing()` runs — the OTel API ships its own no-op tracer as the default global.
- **`initErrorReporting()` / `captureException()`** — Sentry, no-op without `SENTRY_DSN`.
- **`instrumentAdapter(system, adapter, { tenantId, driver? })`** — wraps a `SapAdapter`/`GstnAdapter`/`PaymentGateway` in a `Proxy` that spans + logs every method call. Called once per adapter resolution (`getSapAdapterForTenant`, `getGstnAdapterForTenant`, `getPaymentGatewayForTenant`), not per call site — the whole point is that none of the ~40 existing adapter-read call sites across the app had to change.
- **`@cc/observability/rate-limit`** — a separate subpath export, deliberately free of `pino`/OTel/Sentry imports so `apps/web/middleware.ts` (edge runtime) can import it without pulling in Node-only code. `createRateLimiter()` returns a process-wide `memory` limiter (fixed window, per key). It is correct within one process; a multi-instance edge deployment gets one window per instance, which is an accepted, documented gap for this phase, not a silent one — a `redis` driver is the extension point when that stops being acceptable.

## Public API

```ts
import {
  getLogger,
  rootLogger,
  runWithContext,
  getContext,
  setContextTenant,
  initTracing,
  shutdownTracing,
  tracer,
  initErrorReporting,
  captureException,
  isErrorReportingInitialized,
  instrumentAdapter,
  env,
} from "@cc/observability";

import {
  createRateLimiter,
  resetRateLimiter,
  MemoryRateLimiter,
} from "@cc/observability/rate-limit";
```

## Environment

All optional or defaulted — see `src/env.ts`. Additive by design: a deploy that sets none of these still runs, logging to stdout with no tracing or error reporting.

| Variable                      | Default                  |
| ----------------------------- | ------------------------ |
| `LOG_LEVEL`                   | `info`                   |
| `OTEL_SERVICE_NAME`           | `customer-portal`        |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset (console spans)    |
| `SENTRY_DSN`                  | unset (no-op)            |
| `SENTRY_ENVIRONMENT`          | `NODE_ENV`/`development` |

## Testing

```
pnpm --filter @cc/observability test
```

Unit only: the rate limiter takes an injectable clock, request-context isolation is asserted across concurrent `runWithContext` calls, and `instrumentAdapter` is asserted against a fake adapter (forwarding, sync and async returns, thrown/rejected errors).
