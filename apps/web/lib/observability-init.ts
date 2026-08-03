import { initErrorReporting, initTracing } from "@cc/observability";

/**
 * Starts tracing/error-reporting exactly once per server process, as a
 * module-level side effect rather than Next's `instrumentation.ts` hook
 * (docs/07 B3). `instrumentation.ts` compiles through a stricter, more
 * special-cased bundling pipeline than an ordinary route module — one that
 * did not respect `serverExternalPackages` for `@sentry/node`'s internal
 * dependency graph (`import-in-the-middle`, its `node:child_process`
 * context integration), and crashed the build outright. This file is an
 * ordinary module imported for its side effect (`import "./observability-init"`)
 * from `admin-route.ts`, `portal-route.ts` and `onboarding-route.ts` — the
 * three files every `/api/*` handler already passes through — which bundle
 * the same dependencies without issue. ES module caching guarantees the
 * calls below still run only once per process, same as they would from
 * `instrumentation.ts`.
 */
initTracing();
initErrorReporting();
