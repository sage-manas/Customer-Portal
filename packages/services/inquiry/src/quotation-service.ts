import type { FreshnessClass, SapAdapter } from "@cc/adapter-sap";
import type {
  Inquiry,
  InvoiceTax,
  Quotation,
  QuotationAcceptBlock,
  QuotationValidity,
  SalesOrderResult,
} from "@cc/domain";
import {
  canRequestQuotationRevision,
  page,
  quotationAcceptBlock,
  quotationTax,
  quotationValidity,
} from "@cc/domain";
import { z } from "zod";

import { InquiryError, invalidFrom } from "./errors";
import { announce, requireAccount, toInquiryError, type InquiryContext } from "./inquiry-service";

/**
 * Quotations (docs/03 Screen 3.2, docs/05 §7.3).
 *
 * SAP owns the document (ADR-016), so nothing here is stored and every read
 * carries its freshness. What this file adds on top of the raw read is the
 * three derived answers every quotation screen needs and none of them may
 * compute for itself: how long it still stands, what the tax split is, and
 * whether it may still be accepted — all from `@cc/domain`, so the button the
 * screen draws and the check the service enforces come from one function.
 */

export interface QuotationView {
  quotation: Quotation;
  /** Derived from VBAK-BNDDT on every read; never stored (ADR-016's reason). */
  validity: QuotationValidity;
  /** The totals card — SAP's own KONV conditions, never computed (ADR-018). */
  tax: InvoiceTax;
  /** Null when the quotation may still be accepted; the reason when it can't. */
  acceptBlock: QuotationAcceptBlock | null;
  /** Doc 05 §7.3: "Request Revision" — also the post-expiry revalidation ask. */
  revisable: boolean;
}

export interface QuotationListResult {
  quotations: QuotationView[];
  total: number;
  /** Expiring-soon count across the whole filtered set, not just this page. */
  expiringCount: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface QuotationDetail extends QuotationView {
  /** The inquiry it answers, when it came from one and could be read. */
  inquiry: Inquiry | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

/**
 * Doc 05 §7.3 filter chips. `expiring` and `expired` are the two the customer
 * actually acts on, and both are *derived from the clock at read time* — a
 * quotation moves between them without anything happening to it in SAP, which
 * is the whole reason expiry is not a status (entities/inquiry.ts).
 */
export type QuotationFilter = "all" | "open" | "expiring" | "expired" | "converted";

export function toQuotationView(quotation: Quotation, now: Date = new Date()): QuotationView {
  return {
    quotation,
    validity: quotationValidity(quotation.validUntil, now),
    tax: quotationTax(quotation),
    acceptBlock: quotationAcceptBlock(quotation, now),
    revisable: canRequestQuotationRevision(quotation),
  };
}

function matchesFilter(view: QuotationView, filter: QuotationFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "converted":
      return Boolean(view.quotation.salesOrder);
    case "open":
      return view.acceptBlock === null;
    case "expiring":
      return view.acceptBlock === null && view.validity.state === "expiring";
    case "expired":
      return view.acceptBlock === "expired";
  }
}

export async function listQuotations(
  adapter: SapAdapter,
  context: InquiryContext,
  options: { filter?: QuotationFilter; now?: Date; limit?: number; offset?: number } = {},
): Promise<QuotationListResult> {
  const account = requireAccount(context);
  const now = options.now ?? new Date();

  const read = await adapter.getQuotations(account).catch((error: unknown) => {
    throw toInquiryError(error, "your quotations");
  });

  const quotations = read.data.items
    .map((quotation) => toQuotationView(quotation, now))
    .filter((view) => matchesFilter(view, options.filter ?? "all"))
    // Soonest to lapse first: a quotation is a deadline, and the one about to
    // expire is the one the customer needs to see. Converted ones have no
    // deadline left and sink to the bottom by the same rule.
    .sort((a, b) => sortKey(a) - sortKey(b));

  return {
    quotations: page(quotations, options),
    total: quotations.length,
    // Counted before paging: "3 expiring" is a fact about the filtered set,
    // not about the page the customer happens to be on.
    expiringCount: quotations.filter(
      (view) => view.acceptBlock === null && view.validity.state === "expiring",
    ).length,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

function sortKey(view: QuotationView): number {
  if (view.quotation.salesOrder) return Number.MAX_SAFE_INTEGER;
  return view.validity.remainingMs < 0 ? Number.MAX_SAFE_INTEGER - 1 : view.validity.remainingMs;
}

/**
 * Reads one quotation and enforces the ownership boundary — the counterpart
 * of `readOwnedInquiry`, and the only way this module reaches a quotation by
 * number.
 */
async function readOwnedQuotation(
  adapter: SapAdapter,
  account: string,
  vbeln: string,
): Promise<{ quotation: Quotation; freshness: FreshnessClass; syncedAt: string }> {
  const read = await adapter.getQuotation(vbeln).catch((error: unknown) => {
    throw toInquiryError(error, "quotation", vbeln);
  });

  if (read.data.kunnr !== account) throw new InquiryError("not_found");

  return { quotation: read.data, freshness: read.freshness, syncedAt: read.syncedAt };
}

export async function getQuotation(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
  options: { now?: Date } = {},
): Promise<QuotationDetail> {
  const account = requireAccount(context);
  const { quotation, freshness, syncedAt } = await readOwnedQuotation(adapter, account, vbeln);

  const inquiry = quotation.inquiry
    ? await adapter
        .getInquiry(quotation.inquiry)
        .then((read) => read.data)
        .catch(() => null)
    : null;

  return {
    ...toQuotationView(quotation, options.now ?? new Date()),
    inquiry,
    freshness,
    syncedAt,
  };
}

export const acceptQuotationSchema = z.object({
  /** VBPA-KUNNR partner SH — chosen from the customer's saved addresses. */
  shipTo: z.string().trim().min(1, "Choose where this should be delivered."),
  customerPoRef: z.string().trim().max(20).optional(),
  requestedDeliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Requested delivery date must be an ISO date (YYYY-MM-DD)")
    .optional(),
});

export type AcceptQuotationInput = z.infer<typeof acceptQuotationSchema>;

export interface AcceptQuotationResult {
  order: SalesOrderResult;
  quotationVbeln: string;
}

/**
 * "Accept & Convert to Order" (docs/05 §7.3) — VA01 with reference to the
 * quotation, so SAP's copy control carries the quoted prices onto the order.
 *
 * The eligibility check is re-derived here from the document SAP returns,
 * never trusted from the screen: the page the button was clicked on may be
 * hours old, and a quotation that lapsed in between must not convert. SAP
 * refuses it too — this check exists so the customer gets the portal's
 * explanation rather than a BAPIRET2 string.
 */
export async function acceptQuotation(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
  input: AcceptQuotationInput,
  options: { now?: Date } = {},
): Promise<AcceptQuotationResult> {
  const account = requireAccount(context);

  const parsed = acceptQuotationSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const { quotation } = await readOwnedQuotation(adapter, account, vbeln);

  const block = quotationAcceptBlock(quotation, options.now ?? new Date());
  if (block) throw new InquiryError("not_allowed", { message: acceptBlockMessage(block) });

  const order = await adapter
    .convertQuoteToOrder({
      quotationVbeln: quotation.vbeln,
      shipTo: parsed.data.shipTo,
      customerPoRef: parsed.data.customerPoRef,
      requestedDeliveryDate: parsed.data.requestedDeliveryDate,
    })
    .catch((error: unknown) => {
      throw toInquiryError(error, "quotation", quotation.vbeln);
    });

  await announce(context, {
    name: "quotation.accepted",
    payload: {
      occurredAt: new Date(),
      kunnr: account,
      documentNumber: quotation.vbeln,
      salesOrder: order.vbeln,
      acceptedByUserId: context.userId,
    },
    dedupeKey: `quotation.accepted:${quotation.vbeln}`,
  });

  return { order, quotationVbeln: quotation.vbeln };
}

function acceptBlockMessage(block: QuotationAcceptBlock): string {
  switch (block) {
    case "expired":
      return "This quotation has expired. Ask for it to be revalidated and we'll send a fresh one.";
    case "converted":
      return "This quotation has already been turned into an order.";
    case "closed":
      return "This quotation is closed. Raise a new inquiry and we'll quote again.";
  }
}

export const revisionRequestSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(10, "Tell the sales team what needs to change — at least 10 characters.")
    .max(2000),
});

export type RevisionRequestInput = z.infer<typeof revisionRequestSchema>;

/**
 * "Request Revision" (docs/05 §7.3), which is also the "Request revalidation"
 * an expired quotation offers — the same message to the same desk, so it is
 * the same call rather than a second endpoint that differs only in its label.
 */
export async function requestRevision(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
  input: RevisionRequestInput,
  options: { now?: Date } = {},
): Promise<QuotationView> {
  const account = requireAccount(context);

  const parsed = revisionRequestSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const { quotation } = await readOwnedQuotation(adapter, account, vbeln);
  if (!canRequestQuotationRevision(quotation)) {
    throw new InquiryError("not_allowed", {
      message:
        "This quotation has already been turned into an order, so there's nothing to revise.",
    });
  }

  const now = options.now ?? new Date();
  const expired = quotationValidity(quotation.validUntil, now).state === "expired";

  const revised = await adapter
    .requestQuotationRevision(quotation.vbeln, parsed.data.comment)
    .catch((error: unknown) => {
      throw toInquiryError(error, "quotation", quotation.vbeln);
    });

  await announce(context, {
    name: "quotation.revision.requested",
    payload: {
      occurredAt: new Date(),
      kunnr: account,
      documentNumber: quotation.vbeln,
      comment: parsed.data.comment,
      expired,
      requestedByUserId: context.userId,
    },
    // The count, not the quotation: a customer may legitimately ask twice, and
    // a key that ignored the second ask would silence a real follow-up.
    dedupeKey: `quotation.revision.requested:${quotation.vbeln}:${revised.revisionRequests?.length ?? 1}`,
  });

  return toQuotationView(revised, now);
}

export { readOwnedQuotation };
