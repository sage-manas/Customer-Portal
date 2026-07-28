import type { DomainEventPayload } from "@cc/domain";

import { insertTicket } from "./ticket-service";

/**
 * Tickets the portal raises for itself.
 *
 * Docs/05 §7.5: a POD discrepancy "auto-creates Support ticket
 * category=Delivery, links delivery doc". A2 emits
 * `delivery.discrepancy.reported` in the transaction that recorded the
 * discrepancy (ADR-026) and left it deliberately unconsumed; this is the
 * consumer, called from the worker handler in `@cc/workers`.
 *
 * It lives in this package rather than in the worker because raising a ticket
 * is the support module's business — the worker's job is to *route* the
 * event, not to know what a ticket needs. That also means the same code path
 * raises it as the customer form does: same numbering, same routing, same
 * `support.ticket.created` event, in one transaction.
 */

/**
 * Priority for a shortfall.
 *
 * Deliberately not the customer's choice — nobody chose. A discrepancy is
 * `high` rather than `critical` because goods have arrived and something is
 * wrong with the count, which is a business problem for tomorrow morning, not
 * a stopped production line. It is also not `medium`: the shipment's paperwork
 * and its contents disagree, and every hour that passes makes the carrier's
 * account of what happened harder to get.
 */
const DISCREPANCY_PRIORITY = "high" as const;

export interface AutoTicketResult {
  ticketId: string;
}

/**
 * Raises the Delivery-category ticket for a POD discrepancy.
 *
 * Idempotent as ADR-023 requires, and structurally so: `sourceKey` is unique
 * per tenant, so a redelivered event hits the constraint and `insertTicket`
 * returns the ticket that already exists rather than raising a second one.
 * The key is the *delivery*, because SAP refuses a second POD — one delivery
 * can only ever justify one discrepancy ticket.
 */
export async function raiseDiscrepancyTicket(
  tenantId: string,
  payload: DomainEventPayload<"delivery.discrepancy.reported">,
): Promise<AutoTicketResult> {
  const ticketId = await insertTicket({
    tenantId,
    kunnr: payload.kunnr,
    // The customer who signed. Kept so the thread shows their name, but the
    // ticket belongs to the account either way — and it is absent when the
    // POD came from a session the portal no longer has.
    raisedByUserId: payload.reportedByUserId,
    category: "delivery",
    priority: DISCREPANCY_PRIORITY,
    subject: subjectFor(payload.documentNumber),
    description: describe(payload),
    relatedDocType: "delivery",
    relatedDocNumber: payload.documentNumber,
    sourceKey: `delivery.discrepancy:${payload.documentNumber}`,
  });

  return { ticketId };
}

/** QMTXT is 40 characters, and the schema enforces it — build to fit. */
function subjectFor(vbeln: string): string {
  return `Delivery discrepancy — ${vbeln}`.slice(0, 40);
}

/**
 * The ticket body.
 *
 * Composed from the event alone. A handler that re-read SAP to describe its
 * own event would fail exactly when SAP is the thing that is down, which is
 * why A2 put the per-line differences into the payload rather than leaving
 * the consumer to fetch them.
 */
function describe(payload: DomainEventPayload<"delivery.discrepancy.reported">): string {
  const parts = [
    `The customer reported a discrepancy when signing for delivery ${payload.documentNumber}` +
      (payload.salesOrder ? ` (sales order ${payload.salesOrder}).` : "."),
    "",
    "Reported differences:",
    ...payload.lines.map(
      (line) =>
        `  • Line ${line.lineNo} — ${line.material}: received ${line.receivedQty} of ${line.dispatchedQty} dispatched.`,
    ),
  ];

  if (payload.lines.length === 0) parts.push(`  • ${payload.reason}`);
  if (payload.notes) parts.push("", `Customer's notes: ${payload.notes}`);

  // The schema's 2000-character limit applies to this text as it does to a
  // typed one; a 40-line delivery must not fail to raise its own ticket.
  return parts.join("\n").slice(0, 2000);
}
