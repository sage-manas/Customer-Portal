/**
 * Frontend-only stand-in for `@cc/service-invoice` (customer invoice reads,
 * credit/debit notes, and the AP/AR registers behind the back-office desks).
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-invoice. Invoice PDFs come from SAP
 * (NAST/GOS) there; demo mode has no bytes to serve.
 */

import {
  billingKind,
  buildAging,
  buildO2CTimeline,
  daysOverdue,
  dueInDays,
  invoiceTax,
  isCreditOrDebitNote,
  isPayable,
  refundCandidates,
  type AgingSummary,
  type Invoice,
  type InvoiceTax,
  type O2CStage,
  type OpenItem,
  type OutgoingPaymentResult,
  type RefundCandidate,
} from "@cc/domain";

import { DemoServiceError, DEMO_FRESHNESS, DEMO_TODAY, demoSyncedAt, requireDemoKunnr } from "./_demo";

import { isSapError, type FreshnessClass, type SapAdapter } from "../sap-mock";

export class InvoiceError extends DemoServiceError {
  constructor(message: string, code = "invoice_error", status = 400) {
    super(message, { code, status });
    this.name = "InvoiceError";
  }
}

export function isInvoiceError(error: unknown): error is InvoiceError {
  return error instanceof InvoiceError;
}

export type InvoiceErrorCode = string;
export type InvoiceIssue = { path: string; message: string };

export function toInvoiceError(error: unknown): InvoiceError {
  if (isInvoiceError(error)) return error;
  return new InvoiceError(
    "We couldn't reach the billing system just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

// ---------------------------------------------------------------------------
// Customer-plane reads
// ---------------------------------------------------------------------------

export type InvoiceStatusFilter = "all" | "open" | "overdue" | "paid";

export interface InvoiceListItem extends Invoice {
  tax: InvoiceTax;
  dueInDays: number;
  daysOverdue: number;
}

export interface InvoiceListResult {
  invoices: InvoiceListItem[];
  total: number;
  aging: AgingSummary | null;
  freshness: FreshnessClass;
  syncedAt: string;
}

function decorate(invoice: Invoice): InvoiceListItem {
  return {
    ...invoice,
    tax: invoiceTax(invoice),
    dueInDays: dueInDays(invoice.dueDate, DEMO_TODAY),
    daysOverdue: daysOverdue(invoice.dueDate, DEMO_TODAY),
  };
}

export async function listInvoices(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { filter?: InvoiceStatusFilter; search?: string; limit?: number; offset?: number } = {},
): Promise<InvoiceListResult> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getInvoices(account).catch((error) => {
    throw toInvoiceError(error);
  });

  // Notes are shown on their own screen (/invoices/notes), not mixed in here.
  let rows = read.data.items.filter((invoice) => !isCreditOrDebitNote(invoice)).map(decorate);

  const filter = options.filter ?? "all";
  rows = rows.filter((row) => {
    switch (filter) {
      case "open":
        return row.status !== "Paid";
      case "overdue":
        return row.daysOverdue > 0 && row.status !== "Paid";
      case "paid":
        return row.status === "Paid";
      default:
        return true;
    }
  });

  const search = options.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (row) =>
        row.vbeln.toLowerCase().includes(search) || row.reference?.toLowerCase().includes(search),
    );
  }

  const openItems = await adapter
    .getOpenItems(account)
    .then((result) => result.data)
    .catch(() => null);

  rows = rows.sort((a, b) => b.billingDate.localeCompare(a.billingDate));
  const total = rows.length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) rows = rows.slice(offset, offset + options.limit);

  return {
    invoices: rows,
    total,
    aging: openItems ? buildAging(openItems, DEMO_TODAY) : null,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface InvoiceDetail {
  invoice: Invoice;
  tax: InvoiceTax;
  dueInDays: number;
  daysOverdue: number;
  openItem: OpenItem | null;
  notes: Invoice[];
  timeline: O2CStage[];
  payable: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getInvoice(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<InvoiceDetail> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getInvoice(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  const invoice = read.data;
  if (invoice.kunnr !== account) throw notFoundInvoice(vbeln);

  const [allInvoices, openItems] = await Promise.all([
    adapter
      .getInvoices(account)
      .then((result) => result.data.items)
      .catch(() => [] as Invoice[]),
    adapter
      .getOpenItems(account)
      .then((result) => result.data)
      .catch(() => [] as OpenItem[]),
  ]);

  const openItem = openItems.find((item) => item.documentNumber === vbeln) ?? null;
  const order = invoice.reference
    ? await adapter
        .getOrderStatus(invoice.reference)
        .then((result) => result.data)
        .catch(() => null)
    : null;

  return {
    invoice,
    tax: invoiceTax(invoice),
    dueInDays: dueInDays(invoice.dueDate, DEMO_TODAY),
    daysOverdue: daysOverdue(invoice.dueDate, DEMO_TODAY),
    openItem,
    notes: allInvoices.filter(
      (row) => isCreditOrDebitNote(row) && row.reference === vbeln,
    ),
    timeline: order
      ? buildO2CTimeline({ order, invoices: [invoice], openItems: openItem ? [openItem] : [] })
      : [],
    payable: isPayable(invoice) && (openItem?.openAmount ?? 0) > 0,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function getInvoicePdfUrl(
  adapter: SapAdapter,
  kunnr: string | undefined,
  vbeln: string,
): Promise<string> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getInvoice(vbeln).catch((error: unknown) => {
    notFoundOrUnavailable(error, vbeln);
  });
  if (read.data.kunnr !== account) throw notFoundInvoice(vbeln);
  // TODO(BACKEND):
  // The real service asks SAP for the archived PDF (GOS). Demo mode has no
  // document to serve, so the screen shows the "not available" state.
  return adapter.getInvoicePdf(vbeln).catch(() => {
    throw new InvoiceError(
      "The invoice PDF isn't available in demo mode. Backend integration pending.",
      "pdf_unavailable",
      503,
    );
  });
}

export async function listCreditDebitNotes(
  adapter: SapAdapter,
  kunnr: string | undefined,
): Promise<InvoiceListResult> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getInvoices(account).catch((error) => {
    throw toInvoiceError(error);
  });

  const rows = read.data.items.filter(isCreditOrDebitNote).map(decorate);
  return {
    invoices: rows.sort((a, b) => b.billingDate.localeCompare(a.billingDate)),
    total: rows.length,
    aging: null,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

function notFoundInvoice(vbeln: string): InvoiceError {
  return new InvoiceError(`We couldn't find document ${vbeln}.`, "not_found", 404);
}

/**
 * Maps a failed invoice lookup to "not found" — unless the failure was SAP
 * being unreachable, which must surface as `upstream_unavailable` instead
 * (docs/05 P7). Confusing the two turns an outage into a false 404.
 */
function notFoundOrUnavailable(error: unknown, vbeln: string): never {
  if (isSapError(error) && error.kind === "unavailable") throw toInvoiceError(error);
  throw notFoundInvoice(vbeln);
}

// ---------------------------------------------------------------------------
// Back-office registers (AP / AR desks)
// ---------------------------------------------------------------------------

export interface RegisterRow extends Invoice {
  dueInDays: number;
  daysOverdue: number;
  taxTotal: number;
}

export interface RegisterResult {
  rows: RegisterRow[];
  total: number;
  totalValue: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

function toRegisterRow(invoice: Invoice): RegisterRow {
  const tax = invoiceTax(invoice);
  return {
    ...invoice,
    dueInDays: dueInDays(invoice.dueDate, DEMO_TODAY),
    daysOverdue: daysOverdue(invoice.dueDate, DEMO_TODAY),
    taxTotal: tax.totalTax,
  };
}

async function register(
  adapter: SapAdapter,
  keep: (invoice: Invoice) => boolean,
): Promise<RegisterResult> {
  const read = await adapter.getBillingRegister().catch((error) => {
    throw toInvoiceError(error);
  });

  const rows = read.data.items.filter(keep).map(toRegisterRow);
  return {
    rows: rows.sort((a, b) => b.billingDate.localeCompare(a.billingDate)),
    total: rows.length,
    totalValue: round2(rows.reduce((sum, row) => sum + row.grossAmount, 0)),
    currency: rows[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

/** AR desk: money coming in — invoices only. */
export async function listInvoiceRegister(adapter: SapAdapter): Promise<RegisterResult> {
  return register(adapter, (invoice) => billingKind(invoice.billingType) === "invoice");
}

/** AP desk: credit and debit notes. */
export async function listNoteRegister(adapter: SapAdapter): Promise<RegisterResult> {
  return register(adapter, isCreditOrDebitNote);
}

export interface RefundQueueResult {
  refunds: RefundCandidate[];
  totalOwed: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listRefundQueue(adapter: SapAdapter): Promise<RefundQueueResult> {
  const [register, ledger] = await Promise.all([
    adapter.getBillingRegister().catch(() => null),
    adapter.getOpenItemsLedger().catch(() => null),
  ]);

  if (!register || !ledger) {
    throw new InvoiceError(
      "We couldn't reach the billing system just now. Try again in a moment.",
      "upstream_unavailable",
      502,
    );
  }

  const refunds = refundCandidates(register.data.items, ledger.data, DEMO_TODAY);
  return {
    refunds,
    totalOwed: round2(refunds.reduce((sum, row) => sum + row.openAmount, 0)),
    currency: refunds[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface PaidRefund extends OutgoingPaymentResult {
  vbeln: string;
  kunnr: string;
}

/** The idempotency key is minted from the document, never randomly (ADR-021). */
export function refundReference(vbeln: string): string {
  return `REFUND-${vbeln}`;
}

export async function payRefund(
  adapter: SapAdapter,
  input: { vbeln: string; kunnr: string; amount: number; currency: string; initiatedBy?: string; note?: string },
): Promise<PaidRefund> {
  const result = await adapter
    .postOutgoingPayment({
      kunnr: input.kunnr,
      documentNumber: input.vbeln,
      amount: input.amount,
      currency: input.currency,
      reference: refundReference(input.vbeln),
      initiatedBy: input.initiatedBy,
      note: input.note,
    })
    .catch((error) => {
      throw toInvoiceError(error);
    });

  return { ...result, vbeln: input.vbeln, kunnr: input.kunnr };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
