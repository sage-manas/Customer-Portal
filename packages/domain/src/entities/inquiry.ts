import { z } from "zod";

import { inquiryMapping } from "../sap-mapping/inquiry";
import { sapStringSchema } from "../sap-mapping/to-zod";

import { invoiceTax, type InvoiceTax } from "./ar";
import type { CreateInquiryInput, Quotation } from "./sales-doc";

/**
 * Inquiry & Quotation (docs/03 Module 3, docs/05 §7.3).
 *
 * SAP owns both documents — an inquiry is VBAK AUART=IN, a quotation is
 * AUART=AG — so this file holds no state and no storage shape, only the rules
 * the screens and the service both have to agree on: what a valid inquiry
 * looks like, how long a quotation stands, and when it may still be accepted.
 *
 * The one rule worth stating up front is what is *absent*: there is no
 * "Expired" status. Doc 05 §6.5 fixes the canonical status vocabulary at
 * twenty-one values and expiry is not one of them — nor should it be, because
 * expiry is not something that happens to a document. It is a comparison
 * between a date SAP already returned and the clock, so it is derived on
 * every read (`quotationValidity`) exactly as an SLA deadline is (ADR-029's
 * reasoning, applied to a document instead of a ticket).
 */

// ---- Document types -------------------------------------------------------

/**
 * VBAK-AUART. Fixed rather than chosen: doc 03 Screen 3.1 gives the customer
 * one inquiry type, and a document type picker in a customer portal is a way
 * to create sales documents a tenant's copy control has never seen.
 */
export const INQUIRY_DOC_TYPE = "IN";
/** VBAK-AUART for the quotation the sales team raises in reply (VA21). */
export const QUOTATION_DOC_TYPE = "AG";

// ---- Write schemas --------------------------------------------------------

/** Constraints come from the registry; only the composition is here. */
const inquiryField = (portalField: string, options?: { required?: boolean }) =>
  sapStringSchema(inquiryMapping, portalField, options);

/**
 * One line of the inquiry form. Same shape as an order line minus the price —
 * the customer is asking what it costs, so a price they supplied would be a
 * number nobody has agreed to.
 */
export const inquiryLineWriteSchema = z.object({
  material: inquiryField("material", { required: true }),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  uom: inquiryField("uom", { required: true }),
});
export type InquiryLineInput = z.infer<typeof inquiryLineWriteSchema>;

export const inquiryHeaderWriteSchema = z.object({
  requiredDeliveryDate: inquiryField("requiredDeliveryDate", { required: true }),
  /**
   * VBAK-ANGDT is NUMC in SAP, but it is a *number of days* to everyone
   * looking at the form, so the portal takes a number and the driver formats
   * it. Bounded at a year: a validity longer than the price list it is quoted
   * from is a promise the tenant cannot keep.
   */
  validityDays: z.coerce
    .number()
    .int("Validity must be a whole number of days")
    .min(1, "Validity must be at least one day")
    .max(365, "Ask for a validity of a year or less")
    .optional(),
  notes: inquiryField("notes").optional(),
});
export type InquiryHeaderInput = z.infer<typeof inquiryHeaderWriteSchema>;

export const inquiryWriteSchema = inquiryHeaderWriteSchema.extend({
  lines: z.array(inquiryLineWriteSchema).min(1, "An inquiry needs at least one item"),
});
export type InquiryInput = z.infer<typeof inquiryWriteSchema>;

/**
 * A draft is the same inquiry with nothing required yet (docs/05 §7.3
 * "Draft/Submit"), for the reason the order draft schema gives: a draft the
 * customer cannot save until it is complete is not a draft.
 */
export const inquiryDraftSchema = inquiryHeaderWriteSchema.partial().extend({
  lines: z.array(inquiryLineWriteSchema).default([]),
});
export type InquiryDraftInput = z.infer<typeof inquiryDraftSchema>;

/** Portal form shape -> adapter contract shape; the sold-to comes from the session. */
export function toCreateInquiryInput(kunnr: string, input: InquiryInput): CreateInquiryInput {
  return {
    kunnr,
    requiredDeliveryDate: input.requiredDeliveryDate,
    validityDays: input.validityDays,
    notes: input.notes,
    lines: input.lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
    })),
  };
}

/**
 * Docs/05 §7.3: the required-date picker starts at "today + lead time".
 *
 * The lead time is per material (MARC-WEBAZ) and the domain layer has no
 * catalogue read, so the caller supplies it — the screen from the materials
 * it is showing, the service from the ones on the inquiry. Returns the
 * message to render, or null when the date is fine, which is the shape every
 * other single-field rule in the domain uses.
 */
export function inquiryRequiredDateIssue(
  requiredDeliveryDate: string,
  today: string,
  leadTimeDays = 0,
): string | null {
  if (requiredDeliveryDate < today) {
    return "Choose a delivery date that isn't in the past.";
  }
  if (leadTimeDays > 0 && requiredDeliveryDate < shiftIsoDays(today, leadTimeDays)) {
    return `The earliest we can commit to is ${shiftIsoDays(today, leadTimeDays)} — ${leadTimeDays} days' lead time on these items.`;
  }
  return null;
}

function shiftIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---- Quotation validity ---------------------------------------------------

/**
 * Docs/05 §7.3: "**Valid Until** with countdown chip amber <72h".
 *
 * The warning window is a registry value rather than a literal in the chip
 * for the same reason the SLA hours are: a threshold that lives in a
 * component is a threshold the service cannot enforce, and the service is
 * what has to refuse an acceptance.
 */
export const QUOTATION_EXPIRY_WARNING_HOURS = 72;

export type QuotationValidityState = "valid" | "expiring" | "expired";

export interface QuotationValidity {
  state: QuotationValidityState;
  /** End of the last day the quotation stands (VBAK-BNDDT, inclusive). */
  expiresAt: Date;
  /** Milliseconds left; negative once expired. */
  remainingMs: number;
  /** Whole days left, rounded up — what the chip says. Zero on the last day. */
  remainingDays: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long this quotation still stands.
 *
 * BNDDT is a date, not a timestamp, and SAP treats it inclusively — a
 * quotation valid until the 31st is acceptable on the 31st. So the deadline
 * is the *end* of that day, which is also what a customer reading "Valid
 * until 31 Jul" believes. Rounding it to midnight-at-the-start would expire
 * every quotation a day early, and the customer would be right to complain.
 */
export function quotationValidity(validUntil: string, now: Date = new Date()): QuotationValidity {
  const expiresAt = new Date(`${validUntil}T23:59:59.999Z`);
  const remainingMs = expiresAt.getTime() - now.getTime();

  const state: QuotationValidityState =
    remainingMs < 0
      ? "expired"
      : remainingMs < QUOTATION_EXPIRY_WARNING_HOURS * HOUR_MS
        ? "expiring"
        : "valid";

  return {
    state,
    expiresAt,
    remainingMs,
    remainingDays: remainingMs < 0 ? 0 : Math.floor(remainingMs / (24 * HOUR_MS)),
  };
}

export function isQuotationExpired(validUntil: string, now: Date = new Date()): boolean {
  return quotationValidity(validUntil, now).state === "expired";
}

/**
 * Whether "Accept & Convert to Order" may be offered (docs/05 §7.3: "Expired
 * quote → actions disabled + Request revalidation").
 *
 * Three separate reasons a quotation is past accepting, and the caller gets
 * the reason rather than a boolean so the screen can say which — "already
 * converted" and "expired" need different next steps, and a disabled button
 * with no explanation is the worst version of both.
 */
export type QuotationAcceptBlock = "expired" | "converted" | "closed";

export function quotationAcceptBlock(
  quotation: Pick<Quotation, "validUntil" | "salesOrder" | "status">,
  now: Date = new Date(),
): QuotationAcceptBlock | null {
  if (quotation.salesOrder) return "converted";
  if (quotation.status === "Closed") return "closed";
  if (isQuotationExpired(quotation.validUntil, now)) return "expired";
  return null;
}

export function isQuotationAcceptable(
  quotation: Pick<Quotation, "validUntil" | "salesOrder" | "status">,
  now: Date = new Date(),
): boolean {
  return quotationAcceptBlock(quotation, now) === null;
}

/**
 * A revision may be asked for at any point a quotation is still the live
 * answer — including after it has expired, which is what doc 05's "Request
 * revalidation" is: the same message to the same sales desk. Once the
 * quotation has become an order there is nothing left to revise.
 */
export function canRequestQuotationRevision(
  quotation: Pick<Quotation, "salesOrder" | "status">,
): boolean {
  return !quotation.salesOrder && quotation.status !== "Closed";
}

// ---- The totals card ------------------------------------------------------

/**
 * The quotation's totals card (docs/05 §7.3: "net + GST breakup + gross").
 *
 * Delegates to `invoiceTax` rather than adding up the conditions again: the
 * portal must never compute GST (docs/02 §5), and the one function that reads
 * which KONV conditions SAP populated should stay the only one (ADR-018).
 */
export function quotationTax(quotation: Quotation): InvoiceTax {
  return invoiceTax({
    taxableAmount: quotation.netValue,
    cgst: quotation.cgst,
    sgst: quotation.sgst,
    igst: quotation.igst,
    grossAmount: quotation.grossValue,
    currency: quotation.currency,
  });
}
