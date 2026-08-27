import {
  earliestSyncedAt,
  isSapError,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type {
  AgingSummary,
  Delivery,
  Invoice,
  InvoiceTax,
  O2CStage,
  OpenItem,
  OrderStatusView,
} from "@cc/domain";
import {
  billingKind,
  buildAging,
  buildO2CTimeline,
  daysOverdue,
  dueInDays,
  invoiceTax,
  isCreditOrDebitNote,
  page,
} from "@cc/domain";

import { InvoiceError } from "./errors";

/**
 * Billing & Invoices (docs/03 Module 6, docs/05 §7.6).
 *
 * SAP owns billing documents, so — exactly like sales orders (ADR-016) —
 * **nothing here is stored**. Every read composes `SapAdapter` calls and
 * carries their freshness. An invoice is a statutory document: a mirrored
 * copy that drifted from VBRK would be worse here than anywhere else in the
 * portal, because the customer's accounts team reconciles against it.
 *
 * The two rules that run through every function:
 *
 * 1. **The sold-to account is the boundary.** `getInvoice` compares the
 *    document's KUNNR to the session's and answers 404 on a mismatch, never
 *    403 — SAP reads a VBRK by VBELN alone, so this check is the control
 *    (CLAUDE.md rule 5).
 * 2. **The portal never computes tax.** CGST/SGST/IGST come off KONV as SAP
 *    calculated them (docs/02 §5); `invoiceTax` in @cc/domain only reads
 *    which conditions were applied to describe the place of supply.
 */

export type InvoiceStatusFilter = "all" | "open" | "overdue" | "paid";

export interface InvoiceListItem extends Invoice {
  tax: InvoiceTax;
  /** Negative once past due — drives the days-left/overdue chip (docs/05 §7.6). */
  dueInDays: number;
  daysOverdue: number;
}

export interface InvoiceListResult {
  invoices: InvoiceListItem[];
  total: number;
  /** Aging over the open items behind these invoices, when AR was readable. */
  aging: AgingSummary | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface InvoiceDetail {
  invoice: Invoice;
  tax: InvoiceTax;
  dueInDays: number;
  daysOverdue: number;
  /** The FI open item for this invoice, when AR could be read. */
  openItem: OpenItem | null;
  /** Credit/debit notes raised against this invoice (VBRP-VGBEL). */
  notes: Invoice[];
  /** The O2C spine, built in @cc/domain and merely rendered (ADR-015). */
  timeline: O2CStage[];
  /** True while there is still something to pay — drives the Pay Now CTA. */
  payable: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

export function toInvoiceError(error: unknown, what: string, id?: string): InvoiceError {
  if (!isSapError(error)) return new InvoiceError("upstream_unavailable", { cause: error });

  switch (error.kind) {
    case "not_found":
      return new InvoiceError("not_found", {
        message: `We couldn't find ${what}${id ? ` ${id}` : ""}.`,
        cause: error,
      });
    default:
      return new InvoiceError("upstream_unavailable", {
        upstreamMessage: error.sapMessage,
        cause: error,
      });
  }
}

function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new InvoiceError("no_account");
  return kunnr;
}

function matchesFilter(invoice: Invoice, filter: InvoiceStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return invoice.status === "Open" || invoice.status === "Overdue";
    case "overdue":
      return invoice.status === "Overdue";
    case "paid":
      return invoice.status === "Paid" || invoice.status === "Cleared";
  }
}

function decorate(invoice: Invoice, today: string): InvoiceListItem {
  return {
    ...invoice,
    tax: invoiceTax(invoice),
    dueInDays: dueInDays(invoice.dueDate, today),
    daysOverdue: daysOverdue(invoice.dueDate, today),
  };
}

/** Today as an ISO date. Injectable so tests don't depend on the wall clock. */
function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The invoice list (docs/05 §7.6: "filters date FY-aware, status
 * Open/Overdue/Paid, aging chip per row").
 *
 * Credit and debit notes are excluded by default and fetched through
 * `listCreditDebitNotes` instead: doc 05 gives them their own tab, and a
 * credit note sitting in the invoice list reads as a bill the customer owes
 * when it is the exact opposite (ADR-020).
 *
 * The AR read is best-effort. Aging is context for the list, not the list
 * itself — a BSID read that fails should cost the customer the aging bar,
 * not their invoices.
 */
export async function listInvoices(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: {
    filter?: InvoiceStatusFilter;
    includeNotes?: boolean;
    today?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<InvoiceListResult> {
  const account = requireKunnr(kunnr);
  const today = options.today ?? isoToday();

  const read = await adapter.getInvoices(account).catch((error: unknown) => {
    throw toInvoiceError(error, "your invoices");
  });

  const openItems = await adapter
    .getOpenItems(account)
    .then((r) => r)
    .catch(() => null);

  const invoices = read.data.items
    .filter((invoice) => options.includeNotes === true || !isCreditOrDebitNote(invoice))
    .filter((invoice) => matchesFilter(invoice, options.filter ?? "all"))
    .map((invoice) => decorate(invoice, today));

  const reads = openItems ? [read, openItems] : [read];

  return {
    invoices: page(invoices, options),
    // The filtered count, which is what the list's own "n invoices" line and
    // the pager report — the unfiltered total there would be a lie.
    total: invoices.length,
    aging: openItems ? buildAging(openItems.data, today) : null,
    freshness: leastFresh(reads),
    syncedAt: earliestSyncedAt(reads),
  };
}

/** The Credit/Debit Notes tab (docs/03 Screen 6.2, docs/05 §7.6). */
export async function listCreditDebitNotes(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { today?: string } = {},
): Promise<InvoiceListResult> {
  const account = requireKunnr(kunnr);
  const today = options.today ?? isoToday();

  const read = await adapter.getInvoices(account).catch((error: unknown) => {
    throw toInvoiceError(error, "your credit and debit notes");
  });

  const notes = read.data.items
    .filter(isCreditOrDebitNote)
    .map((invoice) => decorate(invoice, today));

  return {
    invoices: notes,
    total: notes.length,
    aging: null,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * One billing document with everything the detail screen renders.
 *
 * The chain, the notes raised against it and the FI position are all
 * best-effort for the same reason they are on the order screen: the invoice
 * is what the customer came for, and a failed AR read must not take the page
 * down with it. What is *not* best-effort is the ownership check.
 */
export async function getInvoice(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
  options: { today?: string } = {},
): Promise<InvoiceDetail> {
  const account = requireKunnr(kunnr);
  const today = options.today ?? isoToday();

  const invoiceRead = await adapter.getInvoice(vbeln).catch((error: unknown) => {
    throw toInvoiceError(error, "invoice", vbeln);
  });
  const invoice = invoiceRead.data;

  // SAP reads by VBELN alone, so this is where cross-customer access stops —
  // and it 404s so the answer matches one for an invoice that never existed.
  if (invoice.kunnr !== account) throw new InvoiceError("not_found");

  const [allInvoices, openItems, order, deliveries] = await Promise.all([
    adapter
      .getInvoices(account)
      .then((read) => read.data.items)
      .catch(() => [] as Invoice[]),
    adapter
      .getOpenItems(account)
      .then((read) => read.data)
      .catch(() => [] as OpenItem[]),
    resolveOrder(adapter, invoice),
    resolveDeliveries(adapter, invoice),
  ]);

  const notes = allInvoices.filter(
    (candidate) => candidate.reference === invoice.vbeln && isCreditOrDebitNote(candidate),
  );
  const openItem = openItems.find((item) => item.documentNumber === invoice.vbeln) ?? null;

  return {
    invoice,
    tax: invoiceTax(invoice),
    dueInDays: dueInDays(invoice.dueDate, today),
    daysOverdue: daysOverdue(invoice.dueDate, today),
    openItem,
    notes,
    // Without the originating order there is no chain to draw — the stages
    // are derived from an order, so an invoice we can't trace back to one
    // gets no timeline rather than a fabricated single-stage one.
    timeline: order
      ? buildO2CTimeline({ order, deliveries, invoices: [invoice, ...notes], openItems })
      : [],
    payable:
      billingKind(invoice.billingType) === "invoice" &&
      (openItem
        ? openItem.openAmount > 0
        : invoice.status === "Open" || invoice.status === "Overdue"),
    freshness: invoiceRead.freshness,
    syncedAt: invoiceRead.syncedAt,
  };
}

/**
 * VBRP-VGBEL points at the *preceding* document — usually the delivery, but
 * the order itself when the tenant bills order-related. Both are tried, and
 * a miss simply means no chain rather than an error.
 */
async function resolveOrder(
  adapter: SapAdapter,
  invoice: Invoice,
): Promise<OrderStatusView | null> {
  if (!invoice.reference) return null;

  const direct = await adapter
    .getOrderStatus(invoice.reference)
    .then((read) => read.data)
    .catch(() => null);
  if (direct) return direct;

  const delivery = await adapter
    .getDelivery(invoice.reference)
    .then((read) => read.data)
    .catch(() => null);
  if (!delivery) return null;

  return adapter
    .getOrderStatus(delivery.salesOrder)
    .then((read) => read.data)
    .catch(() => null);
}

async function resolveDeliveries(adapter: SapAdapter, invoice: Invoice): Promise<Delivery[]> {
  if (!invoice.reference) return [];
  return adapter
    .getDelivery(invoice.reference)
    .then((read) => [read.data])
    .catch(() => []);
}

/**
 * "Download Invoice PDF" (docs/03 Screen 6.1).
 *
 * The ownership check is repeated here rather than trusted from the screen
 * that rendered the link: a URL is shareable, and this is the call that
 * actually hands over a statutory document.
 */
export async function getInvoicePdfUrl(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<string> {
  const account = requireKunnr(kunnr);

  const read = await adapter.getInvoice(vbeln).catch((error: unknown) => {
    throw toInvoiceError(error, "invoice", vbeln);
  });
  if (read.data.kunnr !== account) throw new InvoiceError("not_found");

  return adapter.getInvoicePdf(vbeln).catch((error: unknown) => {
    throw toInvoiceError(error, "the PDF for invoice", vbeln);
  });
}
