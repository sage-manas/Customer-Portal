import { billingKind, buildAging, daysOverdue, dueInDays, type AgingSummary } from "./ar";
import type { RebateAgreement } from "./customer";
import type { Invoice, OpenItem, OrderStatusView } from "./sales-doc";

/**
 * The AP and AR desks (docs/09-RBAC-RESTRUCTURE-PLAN.md §3.4, doc 10 Phase 6).
 *
 * Two workspaces on the tenant plane: AP looks at money going out (credit
 * notes, refunds owed, rebate settlements, gateway exceptions), AR at money
 * coming in (the invoice register, open items, aging, receipts, dunning).
 *
 * Everything here is *derivation over a tenant-wide read*, exactly as
 * `ar.ts` is derivation over a customer's. SAP owns every document a desk
 * looks at, so the portal stores none of them (ADR-016) and the desks reuse
 * the same arithmetic the customer screens use — `buildAging` buckets one
 * account's ledger and the whole tenant's identically, which is the point of
 * CLAUDE.md rule 3. Two things this module deliberately does not contain:
 *
 *  - **A second aging implementation.** `agingByCustomer` calls `buildAging`
 *    per account; it does not re-bucket. A desk total that disagreed with the
 *    customer's own statement would be the worst possible bug on this screen.
 *  - **Any notion of executing a refund, a settlement or a credit release.**
 *    Those are FI/SD transactions (F-58, VB(7, VKM3) and the adapter has no
 *    method for them — see ADR-059. What the desk gets is the queue and the
 *    evidence; the money moves in SAP.
 */

// ---- The tenant-wide ledger ---------------------------------------------

/**
 * An FI open item with the account it belongs to.
 *
 * `OpenItem` carries no KUNNR because the customer-plane read is already
 * bounded by one — the account is the argument. A tenant-wide read has no
 * such argument, so the owner has to travel on the row; carrying it on the
 * document rather than looking it up afterwards is ADR-025's rule (the
 * boundary is one comparison, never a second read that can fail open).
 */
export interface LedgerOpenItem extends OpenItem {
  /** BSID-KUNNR. */
  kunnr: string;
}

/** One account's slice of the tenant ledger, as the AR desk lists it. */
export interface CustomerLedgerRow {
  kunnr: string;
  aging: AgingSummary;
  /** Days overdue of the oldest still-open item — the desk's sort key. */
  oldestOverdueDays: number;
  openItemCount: number;
}

/**
 * The ledger rolled up per account, worst first.
 *
 * Sorted by overdue amount rather than by total outstanding: a large account
 * that pays on time is not the one a collections desk should open first.
 * Accounts with nothing open are dropped — a desk queue lists work, and a
 * settled account is not work.
 */
export function agingByCustomer(
  items: readonly LedgerOpenItem[],
  today: string,
): CustomerLedgerRow[] {
  const byAccount = new Map<string, LedgerOpenItem[]>();
  for (const item of items) {
    if (item.openAmount <= 0) continue;
    const bucket = byAccount.get(item.kunnr);
    if (bucket) bucket.push(item);
    else byAccount.set(item.kunnr, [item]);
  }

  return [...byAccount.entries()]
    .map(([kunnr, accountItems]): CustomerLedgerRow => ({
      kunnr,
      aging: buildAging(accountItems, today),
      oldestOverdueDays: accountItems.reduce(
        (worst, item) => Math.max(worst, daysOverdue(item.dueDate, today)),
        0,
      ),
      openItemCount: accountItems.length,
    }))
    .sort(
      (a, b) =>
        b.aging.totalOverdue - a.aging.totalOverdue ||
        b.oldestOverdueDays - a.oldestOverdueDays ||
        a.kunnr.localeCompare(b.kunnr),
    );
}

// ---- Dunning (AR) --------------------------------------------------------

/**
 * Dunning levels, as a registry for the same reason every other ladder in
 * this codebase is one (CLAUDE.md rule 3): the screen renders the level it is
 * given and never decides one, so re-cutting a tenant's escalation policy is
 * an edit here rather than a hunt through components.
 *
 * The thresholds mirror the aging buckets on purpose. A desk that dunned on a
 * different calendar from the one the aging bar draws would be showing two
 * answers to "how late is this?" on the same screen.
 */
export const DUNNING_LEVELS = [
  {
    level: 0,
    key: "none",
    label: "Not due",
    fromDays: Number.NEGATIVE_INFINITY,
    action: "Nothing to chase.",
  },
  {
    level: 1,
    key: "reminder",
    label: "Reminder",
    fromDays: 1,
    action: "A friendly reminder — most of these clear themselves.",
  },
  {
    level: 2,
    key: "first-notice",
    label: "First notice",
    fromDays: 31,
    action: "Formal notice; ask the account for a payment date.",
  },
  {
    level: 3,
    key: "second-notice",
    label: "Second notice",
    fromDays: 61,
    action: "Escalate to the account owner.",
  },
  {
    level: 4,
    key: "final-notice",
    label: "Final notice",
    fromDays: 91,
    action: "Consider a credit block before further supply.",
  },
] as const;

export type DunningLevel = (typeof DUNNING_LEVELS)[number];
export type DunningLevelKey = DunningLevel["key"];

/** The level a given lateness earns. Never stored — derived on every read,
 * for ADR-033's reason: a stored level is wrong the next morning. */
export function dunningLevelFor(days: number): DunningLevel {
  let matched: DunningLevel = DUNNING_LEVELS[0];
  for (const level of DUNNING_LEVELS) {
    if (days >= level.fromDays) matched = level;
  }
  return matched;
}

export interface DunningCandidate {
  kunnr: string;
  level: DunningLevel;
  /** Overdue only — the balance that is actually chaseable. */
  overdueAmount: number;
  oldestOverdueDays: number;
  documentCount: number;
  currency: string;
}

/**
 * Accounts worth dunning, most escalated first.
 *
 * The level comes from the *oldest* overdue item rather than from the largest:
 * escalation is about how long the tenant has been waiting, and an account
 * that pays its new invoices while a 200-day item sits there is exactly the
 * one a level derived from amount would hide.
 */
export function dunningCandidates(
  items: readonly LedgerOpenItem[],
  today: string,
): DunningCandidate[] {
  const rows = agingByCustomer(items, today);

  return rows
    .filter((row) => row.aging.totalOverdue > 0)
    .map((row): DunningCandidate => {
      const overdueItems = items.filter(
        (item) =>
          item.kunnr === row.kunnr && item.openAmount > 0 && daysOverdue(item.dueDate, today) > 0,
      );
      return {
        kunnr: row.kunnr,
        level: dunningLevelFor(row.oldestOverdueDays),
        overdueAmount: row.aging.totalOverdue,
        oldestOverdueDays: row.oldestOverdueDays,
        documentCount: overdueItems.length,
        currency: row.aging.currency,
      };
    })
    .sort(
      (a, b) =>
        b.level.level - a.level.level ||
        b.overdueAmount - a.overdueAmount ||
        a.kunnr.localeCompare(b.kunnr),
    );
}

// ---- Refunds (AP) --------------------------------------------------------

/**
 * A credit note the tenant still owes back.
 *
 * "Refund" in this portal is a *reading* of two SAP facts, not a state of its
 * own: a G2 billing document exists, and its FI item has not been cleared.
 * There is no portal-owned refund table and no refund status, because the
 * portal cannot pay one out — settling it is F-58 or a clearing against the
 * account's next invoice, and inventing a status here would produce a second
 * answer to "did the customer get their money?" (ADR-059).
 */
export interface RefundCandidate {
  /** VBRK-VBELN of the credit note. */
  vbeln: string;
  kunnr: string;
  billingDate: string;
  reasonCode?: string;
  /** What the note is worth, gross. */
  noteAmount: number;
  /** What of it is still sitting open in FI — the amount actually owed. */
  openAmount: number;
  daysOutstanding: number;
  currency: string;
}

/**
 * Credit notes with an open FI item behind them, oldest first.
 *
 * A note whose document number has no open item is not listed: SAP has
 * cleared it, whether by payout or by offset against an invoice, and the desk
 * has nothing to do. Notes are matched to items by document number, which is
 * what the FI reference is in a standard SD→FI posting; an unmatched note is
 * treated as settled rather than as owed, because the safe direction to be
 * wrong on a payables queue is to under-claim.
 *
 * A credit's FI posting is *negative* (BSEG posting key 15) — that is what
 * makes it a credit — so "still open" here is a non-zero balance rather than
 * a positive one, and the amount is reported as its magnitude: the desk is
 * asking how much is owed back, and a payables queue rendering −₹14,325 as
 * the sum to pay would be reading the sign of the receivable, not of the
 * obligation. The aging bar keeps ignoring these, deliberately: a credit
 * reduces what the customer owes and is not part of what is chaseable.
 */
export function refundCandidates(
  notes: readonly Invoice[],
  ledger: readonly LedgerOpenItem[],
  today: string,
): RefundCandidate[] {
  const openByDocument = new Map(
    ledger.filter((item) => item.openAmount !== 0).map((item) => [item.documentNumber, item]),
  );

  return notes
    .filter((note) => billingKind(note.billingType) === "credit")
    .flatMap((note): RefundCandidate[] => {
      const item = openByDocument.get(note.vbeln);
      if (!item) return [];
      return [
        {
          vbeln: note.vbeln,
          kunnr: note.kunnr,
          billingDate: note.billingDate,
          reasonCode: note.reasonCode,
          noteAmount: Math.abs(note.grossAmount),
          openAmount: Math.abs(item.openAmount),
          daysOutstanding: Math.max(0, daysOverdue(note.billingDate, today)),
          currency: note.currency,
        },
      ];
    })
    .sort((a, b) => b.daysOutstanding - a.daysOutstanding || a.vbeln.localeCompare(b.vbeln));
}

// ---- Rebate settlement (AP) ---------------------------------------------

/**
 * KONA-BOSTA, as the AP desk reads it. A registry rather than a switch in the
 * screen, for CLAUDE.md rule 3's reason: the desk's queue is "which of these
 * can be settled?", and that answer must have one home.
 */
export const REBATE_SETTLEMENT_STATES = {
  B: { code: "B", label: "Open", settleable: false, hint: "Still accruing." },
  C: {
    code: "C",
    label: "Released for settlement",
    settleable: true,
    hint: "Ready to settle in VB(7.",
  },
  D: { code: "D", label: "Settled", settleable: false, hint: "Credit memo already issued." },
} as const;

export type RebateSettlementCode = keyof typeof REBATE_SETTLEMENT_STATES;
export type RebateSettlementState = (typeof REBATE_SETTLEMENT_STATES)[RebateSettlementCode];

/** An unknown or absent BOSTA reads as open — an agreement the portal cannot
 * classify is one nobody should be told is settled. */
export function rebateSettlementState(status: string | undefined): RebateSettlementState {
  const known = status ? REBATE_SETTLEMENT_STATES[status as RebateSettlementCode] : undefined;
  return known ?? REBATE_SETTLEMENT_STATES.B;
}

export interface RebateSettlementRow {
  agreement: RebateAgreement;
  state: RebateSettlementState;
  /** Whole days until the agreement's validity ends; negative once lapsed. */
  daysToExpiry: number;
  /** Lapsed and unsettled — the rows that cost the tenant a dispute. */
  overdueForSettlement: boolean;
}

/**
 * The settlement queue: releasable first, then the ones about to lapse.
 *
 * Expiry is derived from KONA-BODBE on every read rather than stored, the
 * same rule `quotationValidity` follows (ADR-031) and for the same reason —
 * SAP leaves a lapsed agreement's status alone, so the only honest answer
 * comes from comparing its end date to today.
 */
export function rebateSettlementQueue(
  agreements: readonly RebateAgreement[],
  today: string,
): RebateSettlementRow[] {
  return agreements
    .map((agreement): RebateSettlementRow => {
      const state = rebateSettlementState(agreement.settlementStatus);
      const daysToExpiry = dueInDays(agreement.validTo, today);
      return {
        agreement,
        state,
        daysToExpiry,
        overdueForSettlement: daysToExpiry < 0 && state.code !== "D",
      };
    })
    .sort(
      (a, b) =>
        Number(b.overdueForSettlement) - Number(a.overdueForSettlement) ||
        Number(b.state.settleable) - Number(a.state.settleable) ||
        a.daysToExpiry - b.daysToExpiry,
    );
}

// ---- Credit release (AR) -------------------------------------------------

export interface CreditBlockedOrderRow {
  order: OrderStatusView;
  /** Whole days the order has been held — what the queue sorts on. */
  blockedDays: number;
}

/**
 * Credit-blocked sales orders, longest-held first — doc 05 §8's release
 * queue, which the credit desk has been carrying a note about since A5.
 *
 * Read-only, and that is not a gap: releasing a block is VKM3, the adapter
 * has no method that writes VBUK-CMGST, and a portal button that recorded a
 * "release" nothing acted on would be worse than no button (ADR-059, the same
 * reasoning ADR-035 applies to credit limits). The blocked days come from
 * VBAK-ERDAT because SAP does not date the block itself; it is therefore the
 * age of the *order*, and the screen says so rather than implying the block
 * has a timestamp it does not have.
 */
export function creditBlockedQueue(
  orders: readonly OrderStatusView[],
  today: string,
): CreditBlockedOrderRow[] {
  return orders
    .map((order): CreditBlockedOrderRow => ({
      order,
      blockedDays: Math.max(0, daysOverdue(order.createdOn, today)),
    }))
    .sort((a, b) => b.blockedDays - a.blockedDays || a.order.vbeln.localeCompare(b.order.vbeln));
}
