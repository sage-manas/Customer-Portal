import {
  earliestSyncedAt,
  leastFresh,
  type FreshnessClass,
  type SapAdapter,
} from "@cc/adapter-sap";
import type { Invoice, LedgerOpenItem, RefundCandidate } from "@cc/domain";
import {
  billingKind,
  daysOverdue,
  dueInDays,
  invoiceTax,
  isCreditOrDebitNote,
  refundCandidates,
} from "@cc/domain";

import { toInvoiceError } from "./invoice-service";

/**
 * The billing registers behind the AP and AR workspaces (doc 09 §3.4).
 *
 * A separate file from `invoice-service.ts` for the reason ADR-032 gives and
 * A3/A5 already follow: the desk's read is a *different function*, not the
 * customer's with the account left off. Nothing here takes a KUNNR and
 * nothing here checks one — which is exactly why these entry points must
 * only ever be reached from a `/admin` screen guarded by `finance:ar` or
 * `finance:ap`, and why the underlying adapter call is `getBillingRegister()`
 * rather than `getInvoices` with an argument somebody could forget.
 *
 * Still nothing is stored (ADR-016): a register is VBRK as it stands right
 * now, composed per read and carrying its freshness, exactly like the
 * customer's own invoice list.
 */

export interface RegisterRow extends Invoice {
  dueInDays: number;
  daysOverdue: number;
  /** From KONV as SAP calculated it — the portal never computes GST. */
  taxTotal: number;
}

export interface RegisterResult {
  rows: RegisterRow[];
  total: number;
  /** Gross value of the rows listed, in the register's currency. */
  totalValue: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface RefundQueueResult {
  refunds: RefundCandidate[];
  totalOwed: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toRow(invoice: Invoice, today: string): RegisterRow {
  return {
    ...invoice,
    dueInDays: dueInDays(invoice.dueDate, today),
    daysOverdue: daysOverdue(invoice.dueDate, today),
    taxTotal: invoiceTax(invoice).totalTax,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The AR desk's invoice register: every F2 in the tenant, newest first.
 *
 * Notes are excluded here and listed by `listNoteRegister` instead — the same
 * split ADR-020 makes on the customer's screen, for the same reason: a credit
 * is not a bill, and a register that mixed them would report a receivable
 * total nobody could reconcile.
 */
export async function listInvoiceRegister(
  adapter: SapAdapter,
  options: { today?: string } = {},
): Promise<RegisterResult> {
  const today = options.today ?? isoToday();
  const read = await adapter.getBillingRegister().catch((error: unknown) => {
    throw toInvoiceError(error, "the invoice register");
  });

  const rows = read.data.items
    .filter((invoice) => !isCreditOrDebitNote(invoice))
    .map((invoice) => toRow(invoice, today))
    .sort((a, b) => b.billingDate.localeCompare(a.billingDate) || a.vbeln.localeCompare(b.vbeln));

  return {
    rows,
    total: rows.length,
    totalValue: round2(rows.reduce((sum, row) => sum + row.grossAmount, 0)),
    currency: rows[0]?.currency ?? "INR",
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * The AP desk's note register: G2 and L2 across the tenant, newest first.
 *
 * The value total is the *magnitude* of the notes, not their signed sum: a
 * credit and a debit of the same size do not cancel out into "nothing
 * happened" on a desk whose job is to look at both.
 */
export async function listNoteRegister(
  adapter: SapAdapter,
  options: { today?: string; kind?: "all" | "credit" | "debit" } = {},
): Promise<RegisterResult> {
  const today = options.today ?? isoToday();
  const kind = options.kind ?? "all";

  const read = await adapter.getBillingRegister().catch((error: unknown) => {
    throw toInvoiceError(error, "the credit and debit note register");
  });

  const rows = read.data.items
    .filter((invoice) => isCreditOrDebitNote(invoice))
    .filter((invoice) => kind === "all" || billingKind(invoice.billingType) === kind)
    .map((invoice) => toRow(invoice, today))
    .sort((a, b) => b.billingDate.localeCompare(a.billingDate) || a.vbeln.localeCompare(b.vbeln));

  return {
    rows,
    total: rows.length,
    totalValue: round2(rows.reduce((sum, row) => sum + Math.abs(row.grossAmount), 0)),
    currency: rows[0]?.currency ?? "INR",
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/**
 * The AP desk's refund queue: credit notes whose FI item is still open.
 *
 * Two reads rather than one because the two facts live in two places — the
 * note is VBRK, whether it has been settled is BSID — and the queue is the
 * *conjunction* of them. Composed here rather than in the screen for the
 * usual reason: two screens composing it would eventually compose it
 * differently.
 *
 * There is no "mark refunded" anywhere below. Paying a credit out is F-58 or
 * a clearing run, the adapter has no method for it, and a portal-side status
 * would be a second answer to whether the customer got their money (ADR-059).
 */
export async function listRefundQueue(
  adapter: SapAdapter,
  options: { today?: string } = {},
): Promise<RefundQueueResult> {
  const today = options.today ?? isoToday();

  const [register, ledger] = await Promise.all([
    adapter.getBillingRegister().catch((error: unknown) => {
      throw toInvoiceError(error, "the credit note register");
    }),
    adapter.getOpenItemsLedger().catch((error: unknown) => {
      throw toInvoiceError(error, "the accounts-receivable ledger");
    }),
  ]);

  const refunds = refundCandidates(register.data.items, ledger.data as LedgerOpenItem[], today);

  return {
    refunds,
    totalOwed: round2(refunds.reduce((sum, refund) => sum + refund.openAmount, 0)),
    currency: refunds[0]?.currency ?? "INR",
    freshness: leastFresh([register, ledger]),
    syncedAt: earliestSyncedAt([register, ledger]),
  };
}
