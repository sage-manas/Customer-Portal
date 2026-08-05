import type { FreshnessClass, SapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import type {
  AgingSummary,
  CustomerLedgerRow,
  DunningCandidate,
  LedgerOpenItem,
  Payment,
} from "@cc/domain";
import { agingByCustomer, buildAging, dunningCandidates } from "@cc/domain";

import { PAYMENT_SELECT, toPayment } from "./payment-service";
import { toPaymentReadError } from "./statement-service";

/**
 * The AR desk's ledger (doc 09 §3.4, doc 10 Phase 6).
 *
 * The tenant-wide counterpart of `statement-service.ts`, and a separate file
 * for ADR-032's reason: `getStatement(adapter, kunnr)` and `getTenantLedger`
 * are different functions with different boundaries, not one function whose
 * scope depends on whether a caller remembered an argument. The desk read
 * goes through `getOpenItemsLedger()`, which is likewise its own adapter
 * method.
 *
 * Nothing is stored on the SAP side of this file. The one thing that *is*
 * read from a portal table is `listPaymentsReceived` — payments are the one
 * O2C document the portal owns (ADR-019), and the desk needs the same
 * "captured but not yet posted" window the customer's statement renders as
 * `Pending sync`. It answers "what did we take?" and never "what is owed?",
 * which is what the ledger above it is for.
 */

export interface TenantLedgerResult {
  /** Aging over every account's open items — the desk's headline bar. */
  aging: AgingSummary;
  /** The same ledger rolled up per account, worst overdue first. */
  customers: CustomerLedgerRow[];
  items: LedgerOpenItem[];
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface DunningResult {
  candidates: DunningCandidate[];
  totalOverdue: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every open item in the tenant, aged.
 *
 * The headline aging is `buildAging` over the whole ledger and the per-account
 * rows are `buildAging` per account — the same function in both cases, so the
 * desk's total is the sum of the rows beneath it by construction rather than
 * by two implementations agreeing (CLAUDE.md rule 3).
 */
export async function getTenantLedger(
  adapter: SapAdapter,
  options: { today?: string } = {},
): Promise<TenantLedgerResult> {
  const today = options.today ?? isoToday();

  const read = await adapter.getOpenItemsLedger().catch((error: unknown) => {
    throw toPaymentReadError(error);
  });

  return {
    aging: buildAging(read.data, today),
    customers: agingByCustomer(read.data, today),
    items: read.data,
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

/** Accounts worth chasing, most escalated first (doc 09 §3.4's dunning view). */
export async function listDunningCandidates(
  adapter: SapAdapter,
  options: { today?: string } = {},
): Promise<DunningResult> {
  const today = options.today ?? isoToday();

  const read = await adapter.getOpenItemsLedger().catch((error: unknown) => {
    throw toPaymentReadError(error);
  });

  const candidates = dunningCandidates(read.data, today);

  return {
    candidates,
    totalOverdue: round2(candidates.reduce((sum, row) => sum + row.overdueAmount, 0)),
    freshness: read.freshness,
    syncedAt: read.syncedAt,
  };
}

export interface PaymentsReceivedResult {
  payments: Payment[];
  /** Captured *and* posted — money the gateway has actually taken. */
  totalReceived: number;
  /** The part of it SAP has not cleared yet — the desk's only actionable row. */
  pendingSyncCount: number;
  currency: string;
}

/**
 * Every payment the tenant has taken, newest first.
 *
 * Tenant-wide and therefore a different function from `listPayments`, which
 * requires an account — the same shape `listPaymentExceptions` already uses,
 * and the same reasoning (ADR-032 applied to money). `initiated`, `failed`
 * and `cancelled` rows are listed too: a desk reconciling a gateway statement
 * needs to see the attempts, not only the successes. Only `captured` and
 * `posted` count toward the total, because those are the ones where money
 * moved.
 */
export async function listPaymentsReceived(
  tenantId: string,
  options: { limit?: number } = {},
): Promise<PaymentsReceivedResult> {
  const payments = await runWithTenant(tenantId, () =>
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 200,
      select: PAYMENT_SELECT,
    }),
  ).then((rows) => rows.map(toPayment));

  const received = payments.filter((p) => p.status === "captured" || p.status === "posted");

  return {
    payments,
    totalReceived: round2(received.reduce((sum, p) => sum + p.amount, 0)),
    pendingSyncCount: payments.filter((p) => p.status === "captured").length,
    currency: payments[0]?.currency ?? "INR",
  };
}
