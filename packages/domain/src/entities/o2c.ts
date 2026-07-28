import type { ModuleAccent } from "../navigation";
import type { CanonicalStatus } from "../status";

import { isCreditOrDebitNote } from "./ar";
import type { Delivery, Invoice, OpenItem, OrderStatusView } from "./sales-doc";

/**
 * The Order-to-Cash spine (docs/05-UI-UX-DESIGN.md P4: "Status is a spine,
 * not a decoration — the O2C chain is one continuous status timeline the
 * user can traverse from any document"), rendered by `O2CTimeline` in
 * @cc/ui on every document detail page (§3.2).
 *
 * The stages and the rules for deriving each one's state live here, not in
 * the component: the timeline is the same five stages whether it is drawn
 * from an order, a delivery or an invoice, and a second implementation per
 * screen is how two screens come to disagree about whether an order shipped.
 * The component receives `O2CStage[]` and renders it (CLAUDE.md rule 3).
 */

export type O2CStageKey = "order" | "creditCheck" | "delivery" | "invoice" | "payment";

export interface O2CStageDef {
  key: O2CStageKey;
  label: string;
  /** Module accent the stage belongs to (docs/05 §2.1). */
  accent: ModuleAccent;
}

export const O2C_STAGES: readonly O2CStageDef[] = [
  { key: "order", label: "Order", accent: "order" },
  { key: "creditCheck", label: "Credit Check", accent: "payment" },
  { key: "delivery", label: "Delivery", accent: "delivery" },
  { key: "invoice", label: "Invoice", accent: "invoice" },
  { key: "payment", label: "Payment", accent: "payment" },
] as const;

/** A document number the stage links to (docs/05 §4.2 cross-document jumps). */
export interface O2CDocumentRef {
  value: string;
  href: string;
}

export interface O2CStage extends O2CStageDef {
  /**
   * Null while the process has not reached this stage. A null stage is drawn
   * greyed out and carries no date — never as "Open", which would claim the
   * stage is in flight when nothing has happened yet.
   */
  status: CanonicalStatus | null;
  /** ISO date the stage was reached. */
  date?: string;
  documents: O2CDocumentRef[];
  /** One line of plain English; no SAP vocabulary (docs/05 §11). */
  note?: string;
}

export interface O2CTimelineInput {
  order: OrderStatusView;
  /** Deliveries created from the order; empty until VL01N has run. */
  deliveries?: readonly Delivery[];
  /** Billing documents referencing the order or its deliveries. */
  invoices?: readonly Invoice[];
  /**
   * FI open items for those invoices, once the AR module can supply them
   * (Phase 5). Optional because the delivery and order screens can render
   * the chain without an AR read — absent, the payment stage falls back to
   * the billing document's own status, which is what it did before.
   */
  openItems?: readonly OpenItem[];
}

/** Statuses that mean "this document has reached the end of its own chain". */
const DELIVERED: readonly CanonicalStatus[] = ["Delivered"];

/**
 * Derives the five stage states from whatever documents SAP actually
 * returned. Absence is meaningful throughout: no delivery means the delivery
 * stage has not started, not that it failed.
 */
export function buildO2CTimeline({
  order,
  deliveries = [],
  invoices = [],
  openItems = [],
}: O2CTimelineInput): O2CStage[] {
  const byKey: Record<O2CStageKey, Omit<O2CStage, keyof O2CStageDef>> = {
    order: orderStage(order),
    creditCheck: creditStage(order),
    delivery: deliveryStage(deliveries),
    invoice: invoiceStage(invoices),
    payment: paymentStage(invoices, openItems),
  };

  return O2C_STAGES.map((stage) => ({ ...stage, ...byKey[stage.key] }));
}

function orderStage(order: OrderStatusView): Omit<O2CStage, keyof O2CStageDef> {
  return {
    status: order.orderStatus,
    date: order.createdOn,
    documents: [{ value: order.vbeln, href: `/orders/${order.vbeln}` }],
    note: order.rejectionReason
      ? `Cancelled — ${order.rejectionReason}`
      : order.customerPoRef
        ? `Your reference ${order.customerPoRef}`
        : undefined,
  };
}

/**
 * The credit gate (docs/03 Module 4 flow: "Credit check gate: Released ->
 * delivery planning; Blocked -> credit team release"). This is the one stage
 * that is never merely informational — a blocked order stops here.
 */
function creditStage(order: OrderStatusView): Omit<O2CStage, keyof O2CStageDef> {
  if (order.creditStatus === "CreditHold") {
    return {
      status: "CreditHold",
      documents: [],
      note: "On hold — our credit team is reviewing this order.",
    };
  }
  return {
    status: order.creditStatus,
    documents: [],
    note: order.creditStatus === "Confirmed" ? "Released for delivery planning." : undefined,
  };
}

function deliveryStage(deliveries: readonly Delivery[]): Omit<O2CStage, keyof O2CStageDef> {
  if (deliveries.length === 0) return { status: null, documents: [] };

  // The chain is only as far along as its least-advanced delivery: a part-
  // shipped order has not "delivered", however many of its lines have.
  const allDelivered = deliveries.every((d) => DELIVERED.includes(d.status));
  const anyDelivered = deliveries.some((d) => DELIVERED.includes(d.status));

  return {
    status: allDelivered
      ? "Delivered"
      : anyDelivered
        ? "PartiallyDelivered"
        : deliveries[0]!.status,
    date: latestDate(deliveries.map((d) => d.actualGoodsIssue ?? d.plannedGoodsIssue)),
    documents: deliveries.map((d) => ({ value: d.vbeln, href: `/deliveries/${d.vbeln}` })),
  };
}

/**
 * Credit and debit notes are billing documents (ADR-020) but they are not
 * what "Invoiced" means: a chain whose only billing document is a credit
 * note has not been billed. They are still linked, so the note is reachable
 * from the spine — just not counted as the milestone.
 */
function invoiceStage(invoices: readonly Invoice[]): Omit<O2CStage, keyof O2CStageDef> {
  if (invoices.length === 0) return { status: null, documents: [] };

  const bills = invoices.filter((i) => !isCreditOrDebitNote(i));
  const notes = invoices.filter((i) => isCreditOrDebitNote(i));
  const documents = invoices.map((i) => ({ value: i.vbeln, href: `/invoices/${i.vbeln}` }));

  if (bills.length === 0) return { status: null, documents };

  return {
    status: "Invoiced",
    date: latestDate(bills.map((i) => i.billingDate)),
    documents,
    note:
      notes.length > 0
        ? `${notes.length === 1 ? "A credit/debit note has" : `${notes.length} credit/debit notes have`} been raised against this.`
        : undefined,
  };
}

/**
 * Payment, read off the FI open items for these invoices when the caller has
 * them, and off the billing documents' own statuses when it doesn't.
 *
 * The open items are the better answer because they are what SAP actually
 * clears against: a part-paid invoice still says `Open` on VBRK while BSID
 * shows most of it settled, and a customer looking at the spine wants the
 * second number. The clearing document is linked, since that is the receipt
 * their accounts team will reconcile against (docs/05 §4.2 cross-document
 * jumps).
 */
function paymentStage(
  invoices: readonly Invoice[],
  openItems: readonly OpenItem[],
): Omit<O2CStage, keyof O2CStageDef> {
  if (invoices.length === 0) return { status: null, documents: [] };

  const numbers = new Set(invoices.map((i) => i.vbeln));
  const items = openItems.filter((item) => numbers.has(item.documentNumber));

  if (items.length === 0) {
    // No AR read available — fall back to what the billing document says.
    if (invoices.every((i) => i.status === "Paid" || i.status === "Cleared")) {
      return { status: "Paid", documents: [], note: "Settled in full." };
    }
    if (invoices.some((i) => i.status === "Overdue")) {
      return { status: "Overdue", documents: [], note: "Payment is past its due date." };
    }
    return {
      status: "Open",
      documents: [],
      note: `Due ${earliestDate(invoices.map((i) => i.dueDate)) ?? "on terms"}`,
    };
  }

  const outstanding = round2(items.reduce((sum, item) => sum + Math.max(0, item.openAmount), 0));
  const clearingDocuments = [
    ...new Set(items.map((item) => item.clearingDocument).filter((d): d is string => Boolean(d))),
  ];
  const documents = clearingDocuments.map((value) => ({
    value,
    href: `/payments?document=${encodeURIComponent(value)}`,
  }));

  if (outstanding === 0) {
    return { status: "Cleared", documents, note: "Settled in full." };
  }
  if (items.some((item) => item.status === "Overdue" && item.openAmount > 0)) {
    return {
      status: "Overdue",
      documents,
      note: `${outstanding.toFixed(2)} is past its due date.`,
    };
  }
  return {
    status: "Open",
    documents,
    note: `${outstanding.toFixed(2)} due ${earliestDate(items.map((i) => i.dueDate)) ?? "on terms"}`,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function latestDate(dates: ReadonlyArray<string | undefined>): string | undefined {
  return dates
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
}

function earliestDate(dates: ReadonlyArray<string | undefined>): string | undefined {
  return dates
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(0);
}
