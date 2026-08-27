import { z } from "zod";

import type { CanonicalStatus } from "../status";

import type { Delivery, PodLineInput, SalesDocLine } from "./sales-doc";

/**
 * Delivery & Tracking (docs/03 Module 5, docs/05 §7.5).
 *
 * Everything here is derivation, not storage: SAP owns the delivery document
 * (ADR-016), so this module's job is to turn what LIKP/LIPS/WBSTK returned
 * into the shipment stepper, the POD form's defaults, and the one question
 * the POD screen exists to answer — did the quantity that arrived match the
 * quantity that was dispatched?
 *
 * The stepper is a registry for the same reason the O2C timeline is (ADR-015):
 * `/deliveries` and `/deliveries/[vbeln]` both draw it, and two screens that
 * each carry their own stage list are two screens that will eventually
 * disagree about what "Packed" means.
 */

// ---- The shipment stepper -------------------------------------------------

export type DeliveryStageKey = "notStarted" | "picked" | "packed" | "shipped" | "delivered";

export interface DeliveryStageDef {
  key: DeliveryStageKey;
  label: string;
  /**
   * The canonical status that means this stage has been *reached*.
   * `notStarted` has none — it is the absence of progress, not a status SAP
   * ever reports.
   */
  status: CanonicalStatus | null;
}

/**
 * Docs/05 §7.5: "status stepper Not Started → Picked → Packed → Shipped →
 * Delivered (WBSTK + PGI events)". The order is the progression, so a stage's
 * index in this array *is* how far along it is — see `deliveryStageIndex`.
 */
export const DELIVERY_STAGES: readonly DeliveryStageDef[] = [
  { key: "notStarted", label: "Not started", status: null },
  { key: "picked", label: "Picked", status: "Picked" },
  { key: "packed", label: "Packed", status: "Packed" },
  { key: "shipped", label: "Shipped", status: "InTransit" },
  { key: "delivered", label: "Delivered", status: "Delivered" },
] as const;

export interface DeliveryStage extends DeliveryStageDef {
  /** Reached: this stage has happened. */
  reached: boolean;
  /** The stage the shipment is sitting at right now. */
  current: boolean;
}

/**
 * How far along a status is, as an index into `DELIVERY_STAGES`.
 *
 * A status the stepper doesn't model — `Open` on a delivery SAP created but
 * hasn't picked, say — maps to `notStarted` rather than throwing. A shipment
 * whose status the portal can't place still has to render.
 */
export function deliveryStageIndex(status: CanonicalStatus): number {
  const index = DELIVERY_STAGES.findIndex((stage) => stage.status === status);
  return index === -1 ? 0 : index;
}

/** The stepper for one shipment, ready to render (docs/05 §7.5). */
export function buildDeliveryStages(delivery: Pick<Delivery, "status">): DeliveryStage[] {
  const current = deliveryStageIndex(delivery.status);
  return DELIVERY_STAGES.map((stage, index) => ({
    ...stage,
    reached: index <= current,
    current: index === current,
  }));
}

// ---- Proof of delivery ----------------------------------------------------

/**
 * Doc 05 §7.5: "received-qty per line (LFIMG, pre-filled = dispatched,
 * editable)". The default is what was dispatched, so the common case —
 * everything arrived — is one click and no typing.
 */
export function podDefaultLines(lines: readonly SalesDocLine[]): PodLineInput[] {
  return lines.map((line) => ({ lineNo: line.lineNo, receivedQty: line.quantity }));
}

export interface PodLineComparison {
  lineNo: number;
  material: string;
  uom: string;
  dispatchedQty: number;
  receivedQty: number;
  /** Negative for a short receipt, positive for an over-receipt. */
  difference: number;
  short: boolean;
}

export interface PodDiscrepancy {
  /** True when any line differs, in either direction. */
  hasDiscrepancy: boolean;
  lines: PodLineComparison[];
  /** Only the lines that differ — what the auto-ticket describes. */
  differences: PodLineComparison[];
}

/**
 * Compares what arrived against what was dispatched.
 *
 * "Qty mismatch auto-flags discrepancy flow" (docs/05 §7.5) is one rule, so
 * it lives in one function: the POD screen uses it to decide whether Confirm
 * Receipt or Report Discrepancy is the honest button, and the service uses it
 * to decide which one actually happened. A screen that computed this itself
 * could offer "Confirm" for a receipt the service then records as short.
 *
 * An over-receipt counts. It is rarer than a shortfall and more awkward — the
 * customer has goods they were not billed for — but it is still the delivery
 * not matching the paperwork, which is exactly what a discrepancy is.
 */
export function podDiscrepancy(
  dispatched: readonly SalesDocLine[],
  received: readonly PodLineInput[],
): PodDiscrepancy {
  const receivedByLine = new Map(received.map((line) => [line.lineNo, line.receivedQty]));

  const lines: PodLineComparison[] = dispatched.map((line) => {
    // A line the customer didn't fill in is treated as fully received, not as
    // zero: the form pre-fills the dispatched quantity, so an absent line
    // means "untouched", and reading that as "nothing arrived" would raise a
    // discrepancy against a customer who simply confirmed the defaults.
    const receivedQty = receivedByLine.get(line.lineNo) ?? line.quantity;
    const difference = round3(receivedQty - line.quantity);
    return {
      lineNo: line.lineNo,
      material: line.material,
      uom: line.uom,
      dispatchedQty: line.quantity,
      receivedQty,
      difference,
      short: difference < 0,
    };
  });

  const differences = lines.filter((line) => line.difference !== 0);

  return { hasDiscrepancy: differences.length > 0, lines, differences };
}

/** Quantities are QUAN(13,3) in SAP; float subtraction is not. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * One line of plain English describing a discrepancy, used as the auto-ticket's
 * subject (docs/05 §7.5 "auto-creates Support ticket category=Delivery").
 * Built here rather than in the worker because A3 consumes the *event*, and an
 * event whose meaning has to be re-derived downstream is an event that will be
 * re-derived differently.
 */
export function describePodDiscrepancy(discrepancy: PodDiscrepancy): string {
  const parts = discrepancy.differences.map(
    (line) =>
      `${line.material}: received ${line.receivedQty} ${line.uom} of ${line.dispatchedQty} dispatched`,
  );
  return parts.join("; ");
}

/**
 * Whether the POD screen may be opened at all.
 *
 * A customer cannot sign for goods that have not left the warehouse, and once
 * receipt is confirmed the document is closed — SAP's own VLPOD is not a
 * form the customer may resubmit, and the portal must not offer a button that
 * SAP will reject.
 */
export function isPodConfirmable(delivery: Pick<Delivery, "status" | "podConfirmed">): boolean {
  if (delivery.podConfirmed) return false;
  return deliveryStageIndex(delivery.status) >= deliveryStageIndex("InTransit");
}

/**
 * Doc 05 §7.5: the e-way bill is "mandatory >₹50k". The threshold is a
 * statutory number, so it is named once here rather than typed into the
 * screen that warns about it.
 */
export const EWAY_BILL_THRESHOLD_INR = 50_000;

export function ewayBillExpected(netValue: number): boolean {
  return netValue > EWAY_BILL_THRESHOLD_INR;
}

// ---- Write schema ---------------------------------------------------------

/**
 * What the POD route accepts. Validated in the domain layer for the same
 * reason order and payment writes are: the route handler must not be the
 * thing that decides a negative received quantity is acceptable.
 */
export const podConfirmSchema = z.object({
  /** ISO date. A receipt cannot be dated in the future — see below. */
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the receipt date as YYYY-MM-DD."),
  lines: z
    .array(
      z.object({
        lineNo: z.number().int().positive(),
        receivedQty: z.number().min(0, "A received quantity cannot be negative."),
      }),
    )
    .min(1, "Confirm the quantity received for at least one line."),
  /**
   * Free text from the customer (docs/03 Screen 5.2 "Discrepancy notes —
   * portal field"). Portal-owned: there is no LIKP field for it.
   */
  notes: z.string().max(2000).optional(),
  /** Storage key of the signed POD, once uploaded (docs/03 Screen 5.2 GOS). */
  signedPodKey: z.string().max(500).optional(),
});

export type PodConfirmInput = z.infer<typeof podConfirmSchema>;

/**
 * A receipt date in the future is a typo, and a receipt date before the goods
 * were dispatched is either a typo or a dispute — neither belongs in SAP as a
 * silent fact. Checked against the delivery rather than inside the schema,
 * because the bounds come from the document, not from the shape.
 */
export function podReceiptDateIssue(
  receiptDate: string,
  delivery: Pick<Delivery, "actualGoodsIssue">,
  today: string,
): string | null {
  if (receiptDate > today) return "The receipt date can't be in the future.";
  if (delivery.actualGoodsIssue && receiptDate < delivery.actualGoodsIssue) {
    return "The receipt date is before the goods were dispatched.";
  }
  return null;
}
