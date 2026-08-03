import { db } from "@cc/db";
import { sweepSlaBreaches } from "@cc/service-support";

import { env } from "./env";

/**
 * The SLA sweep (docs/03 Module 8 "SLA breach → escalate", ADR-029).
 *
 * The relay publishes events that services wrote; this is the other kind of
 * background work — a fact that becomes true because *time passed and nothing
 * happened*, which no transaction can produce. So a loop asks.
 *
 * It writes to the outbox, not to a queue: the sweep is a producer like any
 * service, and ADR-023's rule that only the relay publishes to BullMQ holds
 * here too. The breach event is picked up on the relay's next tick.
 *
 * Tenancy follows the relay's pattern exactly — list tenants (`Tenant` is not
 * a tenant-owned model), then sweep each inside `runWithTenant`, which
 * `sweepSlaBreaches` does for itself.
 */

export interface SlaSweepResult {
  tenants: number;
  breaches: number;
}

export async function sweepSlaOnce(options: { now?: Date } = {}): Promise<SlaSweepResult> {
  const tenants = await db.tenant.findMany({ select: { id: true } });

  let breaches = 0;
  for (const tenant of tenants) {
    // Sequential for the relay's reason: the sweep shares a connection pool
    // with the request path, and a hundred tenants at once is a self-inflicted
    // outage on the app rather than throughput.
    const found = await sweepSlaBreaches(tenant.id, { now: options.now });
    breaches += found.length;
  }

  return { tenants: tenants.length, breaches };
}

export interface SlaSweepLoop {
  stop(): Promise<void>;
}

/**
 * Runs `sweepSlaOnce` on an interval until stopped.
 *
 * The interval is minutes, not seconds. An SLA is measured in hours, so a
 * breach noticed 60 seconds late is indistinguishable from one noticed
 * instantly — and a tighter tick would be a full table scan per tenant per
 * second to discover, almost always, that nothing has changed.
 */
export function startSlaSweepLoop(
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): SlaSweepLoop {
  const intervalMs = options.intervalMs ?? env.SLA_SWEEP_INTERVAL_MS;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    try {
      await sweepSlaOnce();
    } catch (error) {
      // A failed sweep must not kill the loop: the tickets are still there,
      // still unbreached-in-the-database, and the next tick finds them.
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
