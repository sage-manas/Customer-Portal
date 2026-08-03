import type { CanonicalStatus } from "../status";

import type { Invoice, OpenItem } from "./sales-doc";

/**
 * Accounts receivable: aging, the account statement, and the tax view of a
 * billing document (docs/03-FUNCTIONAL-SPEC.md Modules 6-7, docs/05 §7.6-7.7).
 *
 * Everything here is *derivation*, not storage. SAP owns invoices and FI
 * open items, so the portal keeps none of them (the same rule as ADR-016 for
 * sales orders); what it does own is the arithmetic the screens need — which
 * bucket an overdue item falls in, what a running balance looks like, whether
 * a supply was intra-state — and that arithmetic lives here so the invoice
 * screen, the statement, the AR summary and the dashboard cannot disagree
 * about it (CLAUDE.md rule 3).
 *
 * Two things this module deliberately does *not* do:
 *
 *  - **Compute tax.** CGST/SGST/IGST come off KONV as SAP calculated them
 *    (docs/02 §5). `invoiceTax` only *reads* which of them are populated to
 *    say whether the supply was intra- or inter-state. A portal that
 *    recomputed GST would eventually disagree with the statutory document.
 *  - **Decide that something is overdue when SAP says otherwise.** Status
 *    comes from the document. `dueInDays` is presentation on top of it.
 */

// ---- Aging (docs/05 §3.2 `AmountAging`, Screen 8.2) ----------------------

export type AgingBucketKey = "current" | "d31to60" | "d61to90" | "over90";

export interface AgingBucketDef {
  key: AgingBucketKey;
  label: string;
  /** Days past due, inclusive lower bound. */
  fromDays: number;
  /** Inclusive upper bound; undefined means open-ended. */
  toDays?: number;
}

/**
 * The four buckets doc 03 Screen 8.2 fixes (0-30 / 31-60 / 61-90 / >90).
 * "Current" holds everything not yet 30 days past due, including items that
 * are not due at all — which is why it is labelled by age, not by "overdue".
 */
export const AGING_BUCKETS: readonly AgingBucketDef[] = [
  { key: "current", label: "0–30 days", fromDays: Number.NEGATIVE_INFINITY, toDays: 30 },
  { key: "d31to60", label: "31–60 days", fromDays: 31, toDays: 60 },
  { key: "d61to90", label: "61–90 days", fromDays: 61, toDays: 90 },
  { key: "over90", label: "Over 90 days", fromDays: 91 },
] as const;

export interface AgingBucket extends AgingBucketDef {
  amount: number;
  count: number;
}

export interface AgingSummary {
  buckets: AgingBucket[];
  /** Total still outstanding, across every bucket. */
  totalOutstanding: number;
  /** The part of it that is past its due date — the number worth chasing. */
  totalOverdue: number;
  currency: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two ISO dates, counted on the calendar date alone.
 * Times of day are irrelevant to a payment term and would make "due today"
 * flicker to "overdue" partway through the day.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Days until an item falls due — negative once it is past due. Positive and
 * zero both mean "not yet late"; the day it is due is not a day late.
 */
export function dueInDays(dueDate: string, today: string): number {
  return daysBetween(today, dueDate);
}

/** Days past due, floored at zero for anything not yet due. */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.max(0, daysBetween(dueDate, today));
}

export function agingBucketFor(dueDate: string, today: string): AgingBucketKey {
  const overdue = daysOverdue(dueDate, today);
  for (const bucket of AGING_BUCKETS) {
    if (overdue >= bucket.fromDays && (bucket.toDays === undefined || overdue <= bucket.toDays)) {
      return bucket.key;
    }
  }
  return "current";
}

/**
 * Buckets the outstanding balance of a set of open items. Items with nothing
 * left open are ignored rather than bucketed at zero — a cleared invoice is
 * not part of the receivable, and counting it would inflate the row counts
 * the AR summary drills into.
 */
export function buildAging(
  items: readonly OpenItem[],
  today: string,
  currency = "INR",
): AgingSummary {
  const buckets: AgingBucket[] = AGING_BUCKETS.map((def) => ({ ...def, amount: 0, count: 0 }));
  let totalOutstanding = 0;
  let totalOverdue = 0;

  for (const item of items) {
    if (item.openAmount <= 0) continue;

    const key = agingBucketFor(item.dueDate, today);
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) {
      bucket.amount = round2(bucket.amount + item.openAmount);
      bucket.count += 1;
    }

    totalOutstanding = round2(totalOutstanding + item.openAmount);
    if (daysOverdue(item.dueDate, today) > 0) {
      totalOverdue = round2(totalOverdue + item.openAmount);
    }
  }

  return {
    buckets,
    totalOutstanding,
    totalOverdue,
    currency: items.find((i) => i.currency)?.currency ?? currency,
  };
}

// ---- Account statement (docs/05 §7.7, Screen 7.1) ------------------------

/**
 * BKPF-BLART values the statement filters on. Anything else SAP returns is
 * still listed — the filter narrows the view, it does not hide postings from
 * the running balance.
 */
export const STATEMENT_DOC_TYPES = [
  { code: "RV", label: "Invoice" },
  { code: "DZ", label: "Payment" },
  { code: "G2", label: "Credit Note" },
] as const;

export type StatementDocTypeCode = (typeof STATEMENT_DOC_TYPES)[number]["code"];

/**
 * One row of the statement. Debit and credit are split into two columns
 * rather than carrying one signed amount, because that is how a customer's
 * accounts team reads a statement — and because the sign convention in BSEG
 * (posting key 01 vs 15) is a SAP detail no screen should have to know.
 */
export interface StatementLine {
  documentNumber: string;
  documentType: string;
  postingDate: string;
  dueDate: string;
  /** Increases what the customer owes (invoice, debit note). */
  debit: number;
  /** Reduces it (payment received, credit note). */
  credit: number;
  /** Balance after this posting, in posting-date order. */
  balance: number;
  openAmount: number;
  status: CanonicalStatus;
  clearingDocument?: string;
  currency: string;
}

export interface Statement {
  lines: StatementLine[];
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  currency: string;
}

export interface StatementFilter {
  /** Inclusive ISO date bounds on BKPF-BUDAT. */
  from?: string;
  to?: string;
  docTypes?: readonly string[];
}

/**
 * Builds the running-balance statement from FI open items.
 *
 * The date filter is applied *after* the balance is accumulated, so the
 * opening balance of a filtered range is the real balance carried into it
 * rather than zero. A statement whose first row started from nothing would
 * be arithmetically tidy and financially wrong.
 */
export function buildStatement(
  items: readonly OpenItem[],
  filter: StatementFilter = {},
): Statement {
  const ordered = [...items].sort(
    (a, b) =>
      a.postingDate.localeCompare(b.postingDate) ||
      a.documentNumber.localeCompare(b.documentNumber),
  );

  const currency = ordered.find((i) => i.currency)?.currency ?? "INR";
  const docTypes = filter.docTypes?.length ? new Set(filter.docTypes) : null;

  let balance = 0;
  let openingBalance = 0;
  let totalDebits = 0;
  let totalCredits = 0;
  const lines: StatementLine[] = [];

  for (const item of ordered) {
    // A positive BSEG amount is a debit to the customer (posting key 01);
    // payments and credit notes arrive negative (key 15).
    const debit = item.amount > 0 ? item.amount : 0;
    const credit = item.amount < 0 ? -item.amount : 0;
    balance = round2(balance + item.amount);

    const beforeRange = filter.from !== undefined && item.postingDate < filter.from;
    if (beforeRange) {
      openingBalance = balance;
      continue;
    }
    if (filter.to !== undefined && item.postingDate > filter.to) continue;
    if (docTypes && !docTypes.has(item.documentType)) continue;

    totalDebits = round2(totalDebits + debit);
    totalCredits = round2(totalCredits + credit);

    lines.push({
      documentNumber: item.documentNumber,
      documentType: item.documentType,
      postingDate: item.postingDate,
      dueDate: item.dueDate,
      debit,
      credit,
      balance,
      openAmount: item.openAmount,
      status: item.status,
      clearingDocument: item.clearingDocument,
      currency: item.currency,
    });
  }

  return {
    lines,
    openingBalance,
    closingBalance: lines.at(-1)?.balance ?? openingBalance,
    totalDebits,
    totalCredits,
    currency,
  };
}

// ---- The tax view of a billing document (docs/05 §7.6 tax card) ----------

export type PlaceOfSupply = "intra-state" | "inter-state";

export interface InvoiceTax {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  grossAmount: number;
  placeOfSupply: PlaceOfSupply;
  /**
   * Effective rate as a percentage of the taxable value, rounded to one
   * decimal — the "IGST 18%" in doc 05's example. Derived from the amounts
   * SAP returned rather than from a rate table, so a line-level mix or a
   * cess still reports honestly.
   */
  ratePercent: number;
  currency: string;
}

/**
 * The tax-bearing shape of a document. Taken structurally rather than as an
 * `Invoice` because a quotation carries the same KONV conditions and needs
 * the same card (docs/05 §7.3 totals card) — and a second implementation of
 * "which pair did SAP populate?" is exactly the duplication ADR-018 exists
 * to prevent.
 */
export type TaxedDocument = Pick<
  Invoice,
  "taxableAmount" | "cgst" | "sgst" | "igst" | "grossAmount" | "currency"
>;

/**
 * Reads the tax split off a billing document. Which pair is populated is
 * what determines the place of supply: SAP applies JOCG+JOSG when the ship-to
 * state matches the supplying plant's, JOIG when it doesn't (docs/03 Module 6).
 */
export function invoiceTax(invoice: TaxedDocument): InvoiceTax {
  const totalTax = round2(invoice.cgst + invoice.sgst + invoice.igst);
  const placeOfSupply: PlaceOfSupply = invoice.igst > 0 ? "inter-state" : "intra-state";

  return {
    taxableAmount: invoice.taxableAmount,
    cgst: invoice.cgst,
    sgst: invoice.sgst,
    igst: invoice.igst,
    totalTax,
    grossAmount: invoice.grossAmount,
    placeOfSupply,
    ratePercent:
      invoice.taxableAmount > 0 ? Math.round((totalTax / invoice.taxableAmount) * 1000) / 10 : 0,
    currency: invoice.currency,
  };
}

/** Plain-English summary of the split, for the tax card's caption. */
export function placeOfSupplyLabel(tax: InvoiceTax): string {
  return tax.placeOfSupply === "inter-state"
    ? `Inter-state — IGST ${formatRate(tax.ratePercent)}`
    : `Intra-state — CGST + SGST ${formatRate(tax.ratePercent)}`;
}

function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

// ---- Billing document types (docs/03 Screen 6.2) -------------------------

/**
 * VBRK-FKART, as far as the portal cares: an invoice, or a note that adjusts
 * one. The list screen splits on this — notes get their own tab so a credit
 * never reads as a bill.
 */
export const BILLING_TYPES = {
  F2: { code: "F2", label: "Invoice", kind: "invoice" },
  G2: { code: "G2", label: "Credit Note", kind: "credit" },
  L2: { code: "L2", label: "Debit Note", kind: "debit" },
} as const;

export type BillingTypeCode = keyof typeof BILLING_TYPES;
export type BillingDocumentKind = (typeof BILLING_TYPES)[BillingTypeCode]["kind"];

/**
 * An unknown FKART is treated as an invoice rather than dropped: tenants
 * configure their own billing types (ZF2 and friends), and a document the
 * portal cannot classify still belongs on the customer's list.
 */
export function billingKind(billingType: string | undefined): BillingDocumentKind {
  const known = billingType ? BILLING_TYPES[billingType as BillingTypeCode] : undefined;
  return known?.kind ?? "invoice";
}

export function isCreditOrDebitNote(invoice: Pick<Invoice, "billingType">): boolean {
  return billingKind(invoice.billingType) !== "invoice";
}

/** Invoices the customer can still pay — the ones Make Payment offers. */
export function isPayable(invoice: Pick<Invoice, "status" | "billingType">): boolean {
  return (
    !isCreditOrDebitNote(invoice) && (invoice.status === "Open" || invoice.status === "Overdue")
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
