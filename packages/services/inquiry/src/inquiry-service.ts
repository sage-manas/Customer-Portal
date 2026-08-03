import { isSapError, type FreshnessClass, type SapAdapter } from "@cc/adapter-sap";
import { recordEvent, runWithTenant } from "@cc/db";
import type { Inquiry, InquiryInput, Quotation } from "@cc/domain";
import { inquiryWriteSchema, toCreateInquiryInput } from "@cc/domain";

import { invalidFrom, InquiryError } from "./errors";

/**
 * Inquiry & Quotation, customer plane (docs/03 Module 3, docs/05 §7.3).
 *
 * SAP owns both documents — an inquiry is VBAK AUART=IN, a quotation AUART=AG
 * — so ADR-016 applies exactly as it does to orders, deliveries and invoices:
 * **nothing about either is stored**, every read composes `SapAdapter` calls
 * and carries their freshness (ADR-007). The portal's only rows in this module
 * are drafts (draft-service.ts), which are half-filled forms SAP has no
 * concept of.
 *
 * Two rules run through every function here:
 *
 * 1. **The sold-to account is the boundary.** SAP reads a sales document by
 *    VBELN alone, so every entry point compares the document's own KUNNR to
 *    the session's and answers **404** on a mismatch — never 403, which would
 *    confirm that another customer's quotation exists (CLAUDE.md rule 5).
 * 2. **The document's own dates decide what may be done to it.** Whether a
 *    quotation may still be accepted is derived from VBAK-BNDDT on every read
 *    (`quotationValidity` in @cc/domain), never from a stored flag — see
 *    quotation-service.ts.
 */

export interface InquiryContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

export interface InquiryListItem extends Inquiry {
  /** True while the sales desk still owes this customer a quotation. */
  awaitingQuotation: boolean;
}

export interface InquiryListResult {
  inquiries: InquiryListItem[];
  total: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface InquiryDetail {
  inquiry: Inquiry;
  /** The quotation raised against it, once there is one. */
  quotation: Quotation | null;
  awaitingQuotation: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** Translates a SAP error into the customer-facing module error. */
export function toInquiryError(error: unknown, what: string, id?: string): InquiryError {
  if (!isSapError(error)) return new InquiryError("upstream_unavailable", { cause: error });

  switch (error.kind) {
    case "not_found":
      return new InquiryError("not_found", {
        message: `We couldn't find ${what}${id ? ` ${id}` : ""}.`,
        cause: error,
      });
    case "validation":
      // SAP refusing the document (no condition record, an inquiry already
      // quoted, an expired quotation) is a business answer, not an outage.
      return new InquiryError("rejected", {
        issues: error.field ? [{ field: error.field, message: error.message }] : [],
        message: error.message,
        upstreamMessage: error.sapMessage,
        cause: error,
      });
    default:
      return new InquiryError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

export function requireAccount(context: InquiryContext): string {
  if (!context.kunnr) throw new InquiryError("no_account");
  return context.kunnr;
}

/** Doc 05 §7.3: the list's own states — waiting on sales, or answered. */
export type InquiryFilter = "all" | "awaiting" | "quoted";

function awaitingQuotation(inquiry: Inquiry): boolean {
  return !inquiry.quotation;
}

function matchesFilter(inquiry: Inquiry, filter: InquiryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "awaiting":
      return awaitingQuotation(inquiry);
    case "quoted":
      return !awaitingQuotation(inquiry);
  }
}

export async function listInquiries(
  adapter: SapAdapter,
  context: InquiryContext,
  options: { filter?: InquiryFilter } = {},
): Promise<InquiryListResult> {
  const account = requireAccount(context);

  const read = await adapter.getInquiries(account).catch((error: unknown) => {
    throw toInquiryError(error, "your inquiries");
  });

  const inquiries = read.data.items
    .filter((inquiry) => matchesFilter(inquiry, options.filter ?? "all"))
    .map((inquiry) => ({ ...inquiry, awaitingQuotation: awaitingQuotation(inquiry) }));

  return {
    inquiries,
    // The filtered count — the list's own "n inquiries" line reports what it
    // is showing, and the unfiltered total there would be a lie.
    total: inquiries.length,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * Reads one inquiry and enforces the ownership boundary. Every entry point
 * that takes a VBELN funnels through here, so the check cannot be skipped by
 * adding a function later.
 */
async function readOwnedInquiry(
  adapter: SapAdapter,
  account: string,
  vbeln: string,
): Promise<{ inquiry: Inquiry; freshness: FreshnessClass; syncedAt: string }> {
  const read = await adapter.getInquiry(vbeln).catch((error: unknown) => {
    throw toInquiryError(error, "inquiry", vbeln);
  });

  if (read.data.kunnr !== account) throw new InquiryError("not_found");

  return { inquiry: read.data, freshness: read.freshness, syncedAt: read.syncedAt };
}

export async function getInquiry(
  adapter: SapAdapter,
  context: InquiryContext,
  vbeln: string,
): Promise<InquiryDetail> {
  const account = requireAccount(context);
  const { inquiry, freshness, syncedAt } = await readOwnedInquiry(adapter, account, vbeln);

  // Best-effort: the inquiry is what the customer came for, and a quotation
  // read that fails must not take the screen down. The quotation has its own
  // page, which is where a failure to read it will be reported honestly.
  const quotation = inquiry.quotation
    ? await adapter
        .getQuotation(inquiry.quotation)
        .then((read) => read.data)
        .catch(() => null)
    : null;

  return {
    inquiry,
    quotation,
    awaitingQuotation: awaitingQuotation(inquiry),
    freshness,
    syncedAt,
  };
}

/**
 * Raise an inquiry (VA11 / BAPI_INQUIRY_CREATEFROMDATA2).
 *
 * SAP first and SAP alone: the document is created there, and only once it
 * exists does the portal record the event that tells the sales desk about it.
 * That ordering is ADR-026's, applied to a module with nothing of its own to
 * store — the alternative (event first) would announce an inquiry that may
 * never have been created.
 */
export async function createInquiry(
  adapter: SapAdapter,
  context: InquiryContext,
  input: InquiryInput,
): Promise<Inquiry> {
  const account = requireAccount(context);

  const parsed = inquiryWriteSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const inquiry = await adapter
    .createInquiry(toCreateInquiryInput(account, parsed.data))
    .catch((error: unknown) => {
      throw toInquiryError(error, "this inquiry");
    });

  await announce(context, {
    name: "inquiry.created",
    payload: {
      occurredAt: new Date(),
      kunnr: account,
      documentNumber: inquiry.vbeln,
      requiredDeliveryDate: inquiry.requiredDeliveryDate,
      lineCount: inquiry.lines.length,
      raisedByUserId: context.userId,
    },
    dedupeKey: `inquiry.created:${inquiry.vbeln}`,
  });

  return inquiry;
}

/**
 * Records an event about a document the portal does not store.
 *
 * ADR-023 asks for the outbox row to be written inside the transaction that
 * made the fact true. A module that stores nothing has no such transaction —
 * the fact was made true in SAP — so the row is written on its own, straight
 * after SAP accepted, and **a failure to write it never fails the caller**.
 * The document exists either way and the customer can see it on their list; a
 * lost notification is a smaller harm than telling somebody their inquiry
 * failed when SAP is holding it. See ADR-030.
 */
async function announce(
  context: InquiryContext,
  event: Parameters<typeof recordEvent>[0],
): Promise<void> {
  try {
    await runWithTenant(context.tenantId, () => recordEvent(event));
  } catch {
    // Deliberately swallowed — see above. Nothing the customer can act on,
    // and B3's structured logging is where this becomes visible to operators.
  }
}

export { readOwnedInquiry, announce };
