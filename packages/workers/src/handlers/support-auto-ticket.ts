import { isSupportError, raiseDiscrepancyTicket } from "@cc/service-support";

import { registerHandler } from "./registry";

/**
 * `delivery.discrepancy.reported` → a Delivery-category support ticket.
 *
 * The consumer A2 was written for. Docs/05 §7.5 says a POD discrepancy
 * "auto-creates Support ticket category=Delivery, links delivery doc", and
 * ADR-026 wrote the event in the same transaction as the evidence precisely so
 * that a discrepancy can never be recorded without the ticket that chases it.
 * Until now nothing was registered for it, which is the legitimate no-op
 * ADR-023 describes; this closes it.
 *
 * The handler is a routing decision and nothing else. What a ticket needs —
 * the number, the routing, the subject, the SLA clock — is the support
 * module's business and lives there, so the auto-raised ticket goes through
 * exactly the code path the customer's form does.
 *
 * Idempotent as ADR-023 requires, and structurally rather than by convention:
 * `SupportTicket.sourceKey` is unique per tenant and is derived from the
 * delivery, so a redelivered event returns the ticket that already exists
 * instead of raising a second one.
 */
registerHandler("delivery.discrepancy.reported", async (payload, context) => {
  try {
    await raiseDiscrepancyTicket(context.tenantId, payload);
  } catch (error) {
    // Nothing here may swallow a failure. A discrepancy whose ticket was
    // never raised is a customer who reported damaged goods to nobody, so a
    // failed job — retried by BullMQ, then parked for the exception tray
    // (docs/07 B4) — is the right outcome even for a payload that will never
    // succeed. The rewrite is only so the parked job names the delivery
    // rather than a bare validation message.
    if (isSupportError(error) && error.code === "invalid") {
      throw new Error(
        `Discrepancy for delivery ${payload.documentNumber} could not raise a ticket: ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
});

export {};
