import { trace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { env } from "./env";

/**
 * OpenTelemetry traces "around adapter calls" (docs/07 B3). Node-only, and
 * deliberately never imported from `apps/web/middleware.ts` (edge runtime) —
 * see `context.ts`'s note for the same reason applied to `AsyncLocalStorage`.
 *
 * `NodeTracerProvider` (traces only), not `@opentelemetry/sdk-node`'s
 * batteries-included SDK: the latter auto-registers log and metric
 * exporters that pull in `@grpc/grpc-js`, which itself needs `net`/`tls`/
 * `fs` — none of which Next's webpack bundler can resolve for a route
 * handler, and building the app crashed outright the one time this package
 * depended on it. Traces are the one signal docs/07 B3 actually asks for,
 * so this is the smaller dependency, not a workaround for a bug.
 *
 * `initTracing()` is safe to call with no exporter configured: it falls back
 * to `ConsoleSpanExporter`, so a local dev run sees spans in its terminal
 * rather than either crashing or silently going nowhere. This mirrors
 * `@cc/adapter-cache`'s `memory` driver and `@cc/db`'s `env` master-key
 * driver — the thing that works today without external infrastructure,
 * with the real backend a config change away (`OTEL_EXPORTER_OTLP_ENDPOINT`).
 *
 * Even before `initTracing()` runs, `trace.getTracer(...)` and
 * `startActiveSpan` are safe to call — the OpenTelemetry API package ships
 * its own no-op tracer as the default global, so `instrument-adapter.ts`
 * never needs to check whether tracing was initialized.
 */
let provider: NodeTracerProvider | undefined;

export function initTracing(): void {
  if (provider) return;

  const configured = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const exporter = configured
    ? new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT })
    : new ConsoleSpanExporter();
  // Batching is pointless (and slower to see) against a console exporter
  // that never actually leaves the process.
  const processor = configured
    ? new BatchSpanProcessor(exporter)
    : new SimpleSpanProcessor(exporter);

  provider = new NodeTracerProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME }),
    spanProcessors: [processor],
  });
  provider.register();
}

export async function shutdownTracing(): Promise<void> {
  await provider?.shutdown();
  provider = undefined;
}

export const tracer: Tracer = trace.getTracer("customer-connect-portal");

export type { Span };
