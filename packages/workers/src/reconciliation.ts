import { db } from "@cc/db";
import {
  getPaymentGatewayForTenant,
  listPaymentExceptions,
  reconcilePayment,
} from "@cc/service-payment";
import { requeueStaleFailedOutboxEvents } from "@cc/service-reconciliation";
import { getSapAdapterForTenant } from "@cc/service-sap";

import { env } from "./env";

/**
 * Reconciliation & exception queues (docs/07 B4, docs/DECISIONS.md ADR-044).
 *
 * A third kind of background loop, alongside the relay and the SLA sweep.
 * The relay publishes facts services already wrote (ADR-023); the SLA sweep
 * discovers a fact nobody could have written (ADR-029). This one *retries*:
 * every tick, it asks each module for what it already knows is stuck —
 * `@cc/service-payment`'s captured-but-unposted and initiated-but-unconfirmed
 * payments, `@cc/service-reconciliation`'s failed outbox rows — and gives it
 * another try. Nothing here is a new fact; it is the same idempotent retry a
 * human clicking "Retry" in `/admin/ap` (Reconciliation) would trigger, run on a
 * schedule so most exceptions never need a human at all.
 *
 * Sequential per tenant, same reasoning as the relay and the SLA sweep: this
 * shares a connection pool with the request path.
 */

export interface ReconciliationResult {
  tenants: number;
  paymentsRetried: number;
  outboxRequeued: number;
}

export async function reconcileOnce(options: { now?: Date } = {}): Promise<ReconciliationResult> {
  const tenants = await db.tenant.findMany({ select: { id: true } });

  let paymentsRetried = 0;
  let outboxRequeued = 0;

  for (const tenant of tenants) {
    const exceptions = await listPaymentExceptions(tenant.id, options.now);
    if (exceptions.length > 0) {
      // Resolved once per tenant, and only when there is something to retry —
      // an idle tenant costs nothing beyond the one exception query.
      const sap = await getSapAdapterForTenant(tenant.id);
      const gateway = await getPaymentGatewayForTenant(tenant.id);

      for (const exception of exceptions) {
        try {
          await reconcilePayment(tenant.id, exception.paymentId, { sap, gateway });
          paymentsRetried += 1;
        } catch {
          // The exception is still there for the next tick, and for a human
          // reading `/admin/ap` (Reconciliation) — nothing here may crash the sweep
          // over one payment that still won't post.
        }
      }
    }

    outboxRequeued += await requeueStaleFailedOutboxEvents(tenant.id, { now: options.now });
  }

  return { tenants: tenants.length, paymentsRetried, outboxRequeued };
}

export interface ReconciliationLoop {
  stop(): Promise<void>;
}

/**
 * Runs `reconcileOnce` on an interval until stopped. Minutes, not seconds —
 * a stuck payment or a failed event is already visible in the admin tray, so
 * a tighter tick buys nothing but load against SAP and the gateway.
 */
export function startReconciliationLoop(
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): ReconciliationLoop {
  const intervalMs = options.intervalMs ?? env.RECONCILIATION_INTERVAL_MS;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    try {
      await reconcileOnce();
    } catch (error) {
      // A failed sweep must not kill the loop: every exception it would have
      // retried is still there, unchanged, for the next tick.
      options.onError?.(error);
    }
  };

  const timer = setInterval(() => {
    running = running.then(tick);
  }, intervalMs);
  timer.unref?.();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
