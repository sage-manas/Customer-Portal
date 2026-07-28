import { isSapError, type FreshnessClass, type SapAdapter } from "@cc/adapter-sap";
import type { AgingSummary, Invoice, OpenItem, Statement, StatementFilter } from "@cc/domain";
import { buildAging, buildStatement, daysOverdue, dueInDays, isPayable } from "@cc/domain";

import { PaymentError } from "./errors";

/**
 * Account Statement (docs/03 Screen 7.1, docs/05 §7.7).
 *
 * Nothing is stored: the statement is BSID/BSAD as SAP holds it right now,
 * composed through the adapter and carrying its freshness (ADR-016 applies
 * to FI documents for the same reason it applies to sales orders — a
 * customer's accounts team reconciles against this). The arithmetic — the
 * running balance, the aging buckets — lives in @cc/domain so the statement,
 * the AR summary and the dashboard cannot disagree (ADR-018).
 */

export interface StatementResult {
  statement: Statement;
  aging: AgingSummary;
  /** Payments captured but not yet posted to SAP — the `Pending sync` rows. */
  pendingCount: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

/** An open item the customer can actually select on the Make Payment screen. */
export interface PayableItem {
  documentNumber: string;
  postingDate: string;
  dueDate: string;
  openAmount: number;
  currency: string;
  dueInDays: number;
  daysOverdue: number;
  /** From the billing document, when it could be read — for the invoice link. */
  billingDate?: string;
  reference?: string;
}

export interface PayableItemsResult {
  items: PayableItem[];
  totalOutstanding: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export function toPaymentReadError(error: unknown): PaymentError {
  if (!isSapError(error)) return new PaymentError("upstream_unavailable", { cause: error });
  if (error.kind === "not_found") return new PaymentError("not_found", { cause: error });
  return new PaymentError("upstream_unavailable", {
    upstreamMessage: error.sapMessage,
    cause: error,
  });
}

export function requireKunnr(kunnr: string | undefined | null): string {
  if (!kunnr) throw new PaymentError("no_account");
  return kunnr;
}

function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getStatement(
  adapter: SapAdapter,
  kunnr: string | undefined,
  filter: StatementFilter = {},
  options: { today?: string; pendingCount?: number } = {},
): Promise<StatementResult> {
  const account = requireKunnr(kunnr);
  const today = options.today ?? isoToday();

  const read = await adapter.getOpenItems(account).catch((error: unknown) => {
    throw toPaymentReadError(error);
  });

  return {
    statement: buildStatement(read.data, filter),
    // Aging is over the *whole* ledger, not the filtered range: a customer
    // narrowing the statement to last month still needs to see what they owe
    // in total, and an aging bar that moved with the date filter would be
    // read as the account position when it isn't.
    aging: buildAging(read.data, today),
    pendingCount: options.pendingCount ?? 0,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * Open invoices for the Make Payment step-1 table (docs/05 §7.7).
 *
 * Credit notes are excluded: their FI posting is negative, and offering one
 * "to pay" would be nonsense. They still reduce the balance on the statement
 * — which is where a customer sees the benefit of them.
 */
export async function listPayableItems(
  adapter: SapAdapter,
  kunnr: string | undefined,
  options: { today?: string } = {},
): Promise<PayableItemsResult> {
  const account = requireKunnr(kunnr);
  const today = options.today ?? isoToday();

  const read = await adapter.getOpenItems(account).catch((error: unknown) => {
    throw toPaymentReadError(error);
  });

  // Best-effort enrichment: the billing document gives the row its invoice
  // link and date. A failed read costs the link, not the ability to pay.
  const invoices = await adapter
    .getInvoices(account)
    .then((r) => r.data.items)
    .catch(() => [] as Invoice[]);
  const byNumber = new Map(invoices.map((invoice) => [invoice.vbeln, invoice]));

  const items = read.data
    .filter((item) => item.openAmount > 0 && item.status !== "Cleared")
    .filter((item) => {
      const invoice = byNumber.get(item.documentNumber);
      // No billing document (a manual FI posting) is still payable — the
      // exclusion is only for documents we know are notes.
      return invoice ? isPayable(invoice) : true;
    })
    .map((item) => toPayableItem(item, byNumber.get(item.documentNumber), today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    items,
    totalOutstanding: round2(items.reduce((sum, item) => sum + item.openAmount, 0)),
    currency: items[0]?.currency ?? "INR",
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

function toPayableItem(item: OpenItem, invoice: Invoice | undefined, today: string): PayableItem {
  return {
    documentNumber: item.documentNumber,
    postingDate: item.postingDate,
    dueDate: item.dueDate,
    openAmount: item.openAmount,
    currency: item.currency,
    dueInDays: dueInDays(item.dueDate, today),
    daysOverdue: daysOverdue(item.dueDate, today),
    billingDate: invoice?.billingDate,
    reference: invoice?.reference,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
