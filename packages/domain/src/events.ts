import { z } from "zod";

/**
 * Domain event registry (docs/07 A1, docs/DECISIONS.md ADR-023).
 *
 * Everything asynchronous in the portal is an event on this list. An event is
 * a *contract*, not a string with a `Json` blob attached: it declares the
 * queue it routes to and a Zod schema for its payload, so a producer that
 * gets the shape wrong fails where it is written rather than inside a worker
 * at 3am. The registry rule from CLAUDE.md applies here as it does to SAP
 * fields, statuses and permissions — if you are about to type an event name
 * as a literal somewhere, this file should grow instead.
 *
 * Only the events A1 itself needs are listed. A2–A7 each add their own here
 * and nowhere else; the ones marked "consumed from A3/A7" are declared now
 * because the phase that *emits* them lands before the phase that handles
 * them, and an event with no consumer is a legitimate no-op (the relay
 * publishes it, no handler is registered, the job completes).
 */

// ---- Queues --------------------------------------------------------------

/**
 * BullMQ queue names. Kept few and coarse on purpose: a queue is a unit of
 * *operational* control (concurrency, pause, drain, backlog alarm), not a
 * unit of modelling. Splitting per event type would give an ops dashboard
 * forty numbers and no signal.
 */
export const EVENT_QUEUES = [
  /** Anything that reaches a customer: email, SMS, in-app bell (A7). */
  "notifications",
  /** Work the portal owes itself: auto-tickets, SLA timers, projections. */
  "workflow",
  /** Retries and sweeps against external systems: SAP postings, gateway. */
  "reconciliation",
] as const;

export type EventQueue = (typeof EVENT_QUEUES)[number];

// ---- Payload schemas -----------------------------------------------------

/**
 * Fields every event carries. `occurredAt` is the moment the *fact* happened,
 * which is not the moment the worker sees it — a relay tick, a retry and a
 * backlog all sit in between, and a handler that needs elapsed time (an SLA
 * timer, a "dispatched 2 days ago" line) must measure from here, never from
 * `Date.now()` at handling time.
 */
const eventBase = z.object({
  occurredAt: z.coerce.date(),
});

const sapDocumentEvent = eventBase.extend({
  /** Sold-to account the document belongs to — the security boundary. */
  kunnr: z.string().min(1),
  /** VBELN of the document in SAP. */
  documentNumber: z.string().min(1),
});

// ---- The registry --------------------------------------------------------

/**
 * `event name -> { queue, schema, description }`.
 *
 * Names are `<module>.<thing>.<past tense>`: an event records something that
 * has already happened and is not negotiable, which is exactly why the row is
 * written in the causing transaction (ADR-023). A name in the imperative
 * ("send.email") would be a command, and a command in an outbox is a request
 * the database cannot guarantee — if you find yourself wanting one, the
 * handler is the place to decide, not the producer.
 */
export const DOMAIN_EVENTS = {
  "payment.captured": {
    queue: "reconciliation",
    description: "Gateway took the money; the SAP posting may not have landed yet (ADR-019).",
    schema: eventBase.extend({
      paymentId: z.string().min(1),
      kunnr: z.string().min(1),
      amount: z.number().positive(),
      currency: z.string().min(1),
    }),
  },
  "payment.posted": {
    queue: "notifications",
    description: "SAP cleared the open items; the customer's receipt is final.",
    schema: eventBase.extend({
      paymentId: z.string().min(1),
      kunnr: z.string().min(1),
      fiDocumentNumber: z.string().min(1),
    }),
  },
  "order.created": {
    queue: "notifications",
    description: "A sales order exists in SAP (possibly credit-blocked — that is not an error).",
    schema: sapDocumentEvent.extend({
      creditBlocked: z.boolean().default(false),
    }),
  },
  "delivery.discrepancy.reported": {
    queue: "workflow",
    description: "POD came back short or damaged; A3 turns this into a support ticket.",
    schema: sapDocumentEvent.extend({
      reason: z.string().min(1),
      reportedByUserId: z.string().optional(),
    }),
  },
} as const satisfies Record<string, EventDefinition>;

interface EventDefinition {
  queue: EventQueue;
  description: string;
  schema: z.ZodType;
}

export type DomainEventName = keyof typeof DOMAIN_EVENTS;

export const DOMAIN_EVENT_NAMES = Object.keys(DOMAIN_EVENTS) as DomainEventName[];

/** Payload type for a given event, inferred from its registered schema. */
export type DomainEventPayload<N extends DomainEventName> = z.infer<
  (typeof DOMAIN_EVENTS)[N]["schema"]
>;

export function isDomainEventName(name: string): name is DomainEventName {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENTS, name);
}

export function eventQueue(name: DomainEventName): EventQueue {
  return DOMAIN_EVENTS[name].queue;
}

/**
 * Validates a payload against its registered schema.
 *
 * Called twice on purpose — once by the producer before the row is written,
 * once by the worker before the handler runs. The second check is not
 * paranoia: an outbox row can outlive a deploy, so a worker may be reading
 * events a *previous* version of the schema produced, and it is better to
 * fail that job loudly than to hand a handler a shape it doesn't expect.
 */
export function parseEventPayload<N extends DomainEventName>(
  name: N,
  payload: unknown,
): DomainEventPayload<N> {
  const definition = DOMAIN_EVENTS[name];
  if (!definition) {
    throw new Error(`Unknown domain event "${name}" — add it to DOMAIN_EVENTS in @cc/domain.`);
  }
  return definition.schema.parse(payload) as DomainEventPayload<N>;
}
