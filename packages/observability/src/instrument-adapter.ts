import { SpanStatusCode } from "@opentelemetry/api";

import { getLogger } from "./logger";
import { captureException } from "./sentry";
import { tracer } from "./tracing";

/**
 * Wraps an external-system adapter (`SapAdapter`, `GstnAdapter`,
 * `PaymentGateway`) in a span + structured log around every method call.
 *
 * This is the one place instrumentation happens, not a decorator on every
 * driver method or a `withSpan(...)` call at every service call site —
 * CLAUDE.md rule 3 ("registries, not hand-duplication") applied to tracing.
 * The three adapter resolvers (`@cc/service-sap`, `@cc/service-payment`,
 * `@cc/service-onboarding`) call this once, right after building the
 * adapter and before returning it, so every one of the ~40 SAP-read call
 * sites across the app gets a span for free and none of them had to change.
 *
 * A `Proxy` rather than a subclass or a manual wrapper object: adapters are
 * plain interfaces with no shared base, and a hand-written wrapper would
 * need one method per adapter method, out of sync the moment a contract
 * grows (as SAP's did, five times, across A2–A5).
 */
export interface InstrumentAdapterOptions {
  tenantId: string;
  driver?: string;
}

export function instrumentAdapter<T extends object>(
  system: string,
  adapter: T,
  options: InstrumentAdapterOptions,
): T {
  const logger = getLogger(`adapter.${system}`);

  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function" || typeof prop !== "string") return original;

      return function instrumented(this: unknown, ...args: unknown[]) {
        const method = prop;
        const startedAt = Date.now();

        return tracer.startActiveSpan(`${system}.${method}`, (span) => {
          span.setAttribute("cc.tenant_id", options.tenantId);
          if (options.driver) span.setAttribute("cc.driver", options.driver);

          const onSettled = (error?: unknown) => {
            const durationMs = Date.now() - startedAt;
            const fields = { tenantId: options.tenantId, system, method, durationMs };
            if (error) {
              const normalized = error instanceof Error ? error : new Error(String(error));
              span.recordException(normalized);
              span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
              logger.error({ ...fields, err: normalized }, `${system}.${method} failed`);
              captureException(normalized, { tenantId: options.tenantId, system, method });
            } else {
              logger.debug(fields, `${system}.${method} ok`);
            }
            span.end();
          };

          try {
            // `original` is `Reflect.get`'s return, typed `any` by lib.es2015 —
            // adapter methods are heterogeneous and the Proxy forwards args and
            // the return value untouched, so there is nothing narrower to type it as.
            const result = original.apply(target, args);
            if (result instanceof Promise) {
              return result.then(
                (resolved) => {
                  onSettled();
                  return resolved;
                },
                (error: unknown) => {
                  onSettled(error);
                  throw error;
                },
              );
            }
            onSettled();
            return result;
          } catch (error) {
            onSettled(error);
            throw error;
          }
        });
      };
    },
  });
}
