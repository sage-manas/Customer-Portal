import type { DomainEventName, DomainEventPayload } from "@cc/domain";
import { DOMAIN_EVENTS, eventQueue, type EventQueue } from "@cc/domain";

/**
 * The handler registry — the same registries-not-switch-statements rule
 * CLAUDE.md applies to SAP fields, statuses and permissions, applied to
 * asynchronous work. A queue worker looks a handler up here; it never
 * switches on an event name.
 *
 * Handlers are the one place in the codebase allowed to touch two services
 * in a single file (ADR-022): sequencing across modules is what a worker is
 * for, and it does it the way route handlers do — from above, passing
 * adapters in.
 */

export interface HandlerContext {
  tenantId: string;
  /** Outbox row id — also the BullMQ job id. Useful as an idempotency key. */
  eventId: string;
}

export type EventHandler<N extends DomainEventName> = (
  payload: DomainEventPayload<N>,
  context: HandlerContext,
) => Promise<void>;

type AnyHandler = (payload: never, context: HandlerContext) => Promise<void>;

const handlers = new Map<DomainEventName, AnyHandler[]>();

/**
 * Registers a handler.
 *
 * Several handlers may claim the same event (an order confirmation both
 * notifies and updates a projection) and they run in registration order,
 * each isolated: one throwing does not stop the others, because a failed
 * email must not also lose the projection. The job as a whole still fails,
 * so BullMQ retries — which is safe precisely because handlers are required
 * to be idempotent (ADR-023).
 */
export function registerHandler<N extends DomainEventName>(
  name: N,
  handler: EventHandler<N>,
): void {
  if (!DOMAIN_EVENTS[name]) {
    throw new Error(`Cannot handle unregistered event "${name}" — add it to DOMAIN_EVENTS first.`);
  }
  const existing = handlers.get(name) ?? [];
  existing.push(handler as AnyHandler);
  handlers.set(name, existing);
}

export function handlersFor<N extends DomainEventName>(name: N): EventHandler<N>[] {
  return (handlers.get(name) ?? []) as EventHandler<N>[];
}

/** Which queues actually have work registered — what the process should listen on. */
export function registeredQueues(): EventQueue[] {
  const queues = new Set<EventQueue>();
  for (const name of handlers.keys()) queues.add(eventQueue(name));
  return [...queues];
}

/** Test seam. Never call this from the worker process. */
export function resetHandlers(): void {
  handlers.clear();
}

export class HandlerFailures extends Error {
  constructor(
    readonly eventName: string,
    readonly failures: unknown[],
  ) {
    super(
      `${failures.length} handler(s) failed for "${eventName}": ${failures
        .map((failure) => (failure instanceof Error ? failure.message : String(failure)))
        .join("; ")}`,
    );
    this.name = "HandlerFailures";
  }
}

/**
 * Runs every handler registered for an event.
 *
 * An event with no handler is a deliberate no-op, not an error: the phase
 * that *emits* an event lands before the phase that consumes it (A2 emits
 * the POD discrepancy, A3 turns it into a ticket), and a worker that threw
 * on the unhandled ones would make that ordering impossible.
 */
export async function dispatchEvent<N extends DomainEventName>(
  name: N,
  payload: DomainEventPayload<N>,
  context: HandlerContext,
): Promise<void> {
  const registered = handlersFor(name);
  if (registered.length === 0) return;

  const failures: unknown[] = [];
  for (const handler of registered) {
    try {
      await handler(payload, context);
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) throw new HandlerFailures(name, failures);
}
