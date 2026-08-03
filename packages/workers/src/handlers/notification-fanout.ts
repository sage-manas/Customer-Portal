import { DOMAIN_EVENT_NAMES, isNotifiableEvent } from "@cc/domain";
import { deliverEventNotifications } from "@cc/service-notification";

import { registerHandler } from "./registry";

/**
 * Every notifiable event → the bell inbox and its email mirror (docs/07 A7).
 *
 * The registration loop is the point. A7 consumes eleven events across six
 * modules, and the obvious implementation is eleven `registerHandler` calls
 * that differ only in a string — which means the twelfth event ships with a
 * template nobody wired, and the failure is silence: no error, no job, no
 * notification, and nothing in a diff to notice. Driving registration from
 * `NOTIFICATION_TEMPLATES` makes "declared" and "delivered" the same fact,
 * which is the registries-not-duplication rule (CLAUDE.md rule 3) applied to
 * subscription rather than to data.
 *
 * The handler itself is a routing decision and nothing else. What a
 * notification *is* — who may receive it, what it says, whether it leaves the
 * building — belongs to `@cc/service-notification` and the domain registry,
 * exactly as A3's auto-ticket left ticket-raising to the support module.
 */
for (const eventName of DOMAIN_EVENT_NAMES) {
  if (!isNotifiableEvent(eventName)) continue;

  registerHandler(eventName, async (payload, context) => {
    await deliverEventNotifications(context.tenantId, context.eventId, eventName, payload);
  });
}

export {};
