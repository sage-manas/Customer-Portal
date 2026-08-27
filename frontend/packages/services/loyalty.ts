/**
 * Frontend-only stand-in for `@cc/service-loyalty` (credit position, loyalty
 * tier/rebates, the customer's credit-increase requests and the back-office
 * credit desk that decides them).
 *
 * Credit and rebate figures come from the seeded SAP landscape; credit
 * *requests* are portal-owned and live in the demo store, so raising one as
 * a customer and deciding it as a client_admin both work in a session.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-loyalty. Credit requests move back to
 * the `CreditRequest` table and decisions emit outbox events.
 */

import {
  CREDIT_REQUEST_STATUS_DEFS,
  creditPosition,
  dsoFromDocuments,
  fiscalYearPurchases,
  fiscalYearRange,
  loyaltyStanding,
  rebateSettlementQueue,
  resolveTierThresholds,
  type CreditPosition,
  type CreditRequestStatus,
  type CreditRequestStatusDef,
  type FiscalYearRange,
  type LoyaltyStanding,
  type RebateAgreement,
  type RebateSettlementRow,
  type TierThresholdOverrides,
  type TierThresholds,
} from "@cc/domain";

import {
  DemoServiceError,
  DEMO_FRESHNESS,
  DEMO_TODAY,
  demoStore,
  demoSyncedAt,
  nextSequence,
  requireDemoKunnr,
} from "./_demo";

import type { FreshnessClass, SapAdapter } from "../sap-mock";

export class LoyaltyError extends DemoServiceError {
  constructor(message: string, code = "loyalty_error", status = 400) {
    super(message, { code, status });
    this.name = "LoyaltyError";
  }
}

export function isLoyaltyError(error: unknown): error is LoyaltyError {
  return error instanceof LoyaltyError;
}

export type LoyaltyErrorCode = string;
export type LoyaltyIssue = { path: string; message: string };

export function toLoyaltyError(error: unknown): LoyaltyError {
  if (isLoyaltyError(error)) return error;
  return new LoyaltyError(
    "We couldn't read your account position just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

export function requireAccount(kunnr: string | undefined): string {
  return requireDemoKunnr(kunnr);
}

export interface CreditContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

export interface DeskContext {
  tenantId: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Credit position
// ---------------------------------------------------------------------------

export interface CreditPositionResult {
  position: CreditPosition;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getCreditPosition(
  adapter: SapAdapter,
  context: CreditContext,
): Promise<CreditPositionResult> {
  const account = requireAccount(context.kunnr);
  const [credit, invoices, openItems] = await Promise.all([
    adapter.getCreditInfo(account).catch((error) => {
      throw toLoyaltyError(error);
    }),
    adapter
      .getInvoices(account)
      .then((read) => read.data.items)
      .catch(() => []),
    adapter
      .getOpenItems(account)
      .then((read) => read.data)
      .catch(() => []),
  ]);

  return {
    // DSO from the documents the portal already reads, composed in the
    // domain so no screen can compute it a second way.
    position: creditPosition(credit.data, { dso: dsoFromDocuments(openItems, invoices, { today: DEMO_TODAY }) }),
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function getCreditPositionForDesk(
  adapter: SapAdapter,
  kunnr: string,
): Promise<CreditPositionResult> {
  return getCreditPosition(adapter, { tenantId: "demo-tenant", kunnr });
}

// ---------------------------------------------------------------------------
// Loyalty tier & rebates
// ---------------------------------------------------------------------------

export interface LoyaltyPosition {
  standing: LoyaltyStanding;
  fiscalYear: FiscalYearRange;
  rebates: RebateAgreement[];
  allRebates: RebateAgreement[];
  accruedRebate: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getLoyaltyPosition(
  adapter: SapAdapter,
  context: CreditContext,
): Promise<LoyaltyPosition> {
  const account = requireAccount(context.kunnr);
  const [invoices, rebates] = await Promise.all([
    adapter
      .getInvoices(account)
      .then((read) => read.data.items)
      .catch((error) => {
        throw toLoyaltyError(error);
      }),
    adapter
      .getRebateAgreements(account)
      .then((read) => read.data)
      .catch(() => [] as RebateAgreement[]),
  ]);

  const range = fiscalYearRange(DEMO_TODAY);
  const ytd = fiscalYearPurchases(invoices, range);
  const live = rebates.filter(
    (agreement) => agreement.validFrom <= DEMO_TODAY && agreement.validTo >= DEMO_TODAY,
  );

  return {
    standing: loyaltyStanding(ytd, await getTierThresholds(context.tenantId)),
    fiscalYear: range,
    rebates: live,
    allRebates: rebates,
    accruedRebate: round2(live.reduce((sum, agreement) => sum + (agreement.accruedAmount), 0)),
    currency: invoices[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function getTierThresholds(_tenantId: string): Promise<TierThresholds> {
  // TODO(BACKEND): per-tenant overrides live in the tenant settings table.
  return resolveTierThresholds({});
}

export async function saveTierThresholds(
  _tenantId: string,
  _overrides: TierThresholdOverrides,
): Promise<TierThresholds> {
  throw new LoyaltyError(
    "Tier thresholds are read-only in demo mode. Backend integration pending.",
    "demo_read_only",
    503,
  );
}

// ---------------------------------------------------------------------------
// Credit-increase requests (portal-owned)
// ---------------------------------------------------------------------------

export interface CreditRequestRecord {
  id: string;
  customerKunnr: string;
  requestedByUserId: string | null;
  requestedLimit: number;
  currentLimit: number;
  justification: string;
  status: CreditRequestStatus;
  statusDef: CreditRequestStatusDef;
  approvedLimit: number | null;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const requests = () => demoStore().creditRequests as CreditRequestRecord[];

function withStatus(record: CreditRequestRecord, status: CreditRequestStatus): CreditRequestRecord {
  record.status = status;
  record.statusDef = CREDIT_REQUEST_STATUS_DEFS[status];
  record.updatedAt = new Date();
  return record;
}

export interface CreditRequestListResult {
  requests: CreditRequestRecord[];
  pending: CreditRequestRecord | null;
}

export async function listCreditRequests(
  context: CreditContext,
): Promise<CreditRequestListResult> {
  const account = requireAccount(context.kunnr);
  const rows = requests()
    .filter((row) => row.customerKunnr === account)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { requests: rows, pending: rows.find((row) => row.status === "pending") ?? null };
}

export async function getCreditRequest(
  _tenantId: string,
  id: string,
): Promise<CreditRequestRecord | null> {
  return requests().find((row) => row.id === id) ?? null;
}

export async function requestCreditIncrease(
  context: CreditContext,
  input: { requestedLimit: number; justification: string; currentLimit: number },
): Promise<CreditRequestRecord> {
  const account = requireAccount(context.kunnr);
  const { pending } = await listCreditRequests(context);
  if (pending) {
    throw new LoyaltyError(
      "You already have a credit request with our team. We'll be in touch on that one.",
      "already_pending",
      409,
    );
  }
  if (input.requestedLimit <= input.currentLimit) {
    throw new LoyaltyError(
      "Ask for a limit above your current one.",
      "not_an_increase",
      422,
    );
  }

  const record: CreditRequestRecord = {
    id: `credit-request-${nextSequence("credit-request")}`,
    customerKunnr: account,
    requestedByUserId: context.userId ?? null,
    requestedLimit: input.requestedLimit,
    currentLimit: input.currentLimit,
    justification: input.justification,
    status: "pending",
    statusDef: CREDIT_REQUEST_STATUS_DEFS.pending,
    approvedLimit: null,
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  requests().push(record);
  return record;
}

export async function withdrawCreditRequest(
  context: CreditContext,
  id: string,
): Promise<CreditRequestRecord> {
  const account = requireAccount(context.kunnr);
  const record = requests().find((row) => row.id === id && row.customerKunnr === account);
  if (!record) throw new LoyaltyError("We couldn't find that request.", "not_found", 404);
  if (record.status !== "pending") {
    throw new LoyaltyError("That request has already been decided.", "not_pending", 409);
  }
  return withStatus(record, "withdrawn");
}

// ---------------------------------------------------------------------------
// Credit desk (back office)
// ---------------------------------------------------------------------------

export type CreditQueueFilter = "pending" | "decided" | "all";

export interface CreditQueueResult {
  requests: CreditRequestRecord[];
  counts: Record<CreditQueueFilter, number>;
}

export async function listCreditRequestQueue(
  _context: DeskContext,
  options: { filter?: CreditQueueFilter } = {},
): Promise<CreditQueueResult> {
  const filter = options.filter ?? "pending";
  const all = [...requests()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const pending = all.filter((row) => row.status === "pending");
  const decided = all.filter((row) => row.status !== "pending");

  return {
    requests: filter === "pending" ? pending : filter === "decided" ? decided : all,
    counts: { pending: pending.length, decided: decided.length, all: all.length },
  };
}

export async function getCreditRequestForDesk(
  _context: DeskContext,
  id: string,
): Promise<CreditRequestRecord> {
  const record = requests().find((row) => row.id === id);
  if (!record) throw new LoyaltyError("We couldn't find that request.", "not_found", 404);
  return record;
}

export async function decideCreditRequest(
  context: DeskContext,
  id: string,
  input: { decision: "approve" | "reject"; approvedLimit?: number; note?: string },
): Promise<CreditRequestRecord> {
  const record = await getCreditRequestForDesk(context, id);
  if (record.status !== "pending") {
    throw new LoyaltyError("That request has already been decided.", "not_pending", 409);
  }

  record.approvedLimit = input.decision === "approve" ? (input.approvedLimit ?? record.requestedLimit) : null;
  record.decisionNote = input.note ?? null;
  record.decidedByUserId = context.userId ?? null;
  record.decidedAt = new Date();

  // TODO(BACKEND):
  // The real service writes the approved limit back to SAP (KNKK) through
  // the tenant's adapter and emits a notification event. Demo mode records
  // the decision only — the seeded credit master is unchanged.
  return withStatus(record, input.decision === "approve" ? "approved" : "rejected");
}

// ---------------------------------------------------------------------------
// Rebate settlement desk (AP)
// ---------------------------------------------------------------------------

export type RebateQueueFilter = "settleable" | "open" | "all";

export interface RebateQueueResult {
  rows: RebateSettlementRow[];
  releasedValue: number;
  overdueCount: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listRebateSettlements(
  adapter: SapAdapter,
  filter: RebateQueueFilter = "settleable",
): Promise<RebateQueueResult> {
  const read = await adapter.getRebateRegister().catch((error) => {
    throw toLoyaltyError(error);
  });

  const all = rebateSettlementQueue(read.data, DEMO_TODAY);
  const rows = all.filter((row) => {
    if (filter === "settleable") return row.state.settleable;
    if (filter === "open") return row.state.code !== "D";
    return true;
  });

  return {
    rows,
    releasedValue: round2(
      all
        .filter((row) => row.state.settleable)
        .reduce((sum, row) => sum + row.agreement.accruedAmount, 0),
    ),
    overdueCount: all.filter((row) => row.overdueForSettlement).length,
    currency: read.data[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

/** Minted from the agreement, never randomly — a double click is one payout. */
export function rebateSettlementReference(agreement: string): string {
  return `REBATE-${agreement}`;
}

export async function settleRebate(
  adapter: SapAdapter,
  input: { agreement: string; initiatedBy?: string; note?: string },
) {
  return adapter
    .settleRebateAgreement({
      agreementNumber: input.agreement,
      reference: rebateSettlementReference(input.agreement),
      initiatedBy: input.initiatedBy,
      note: input.note,
    })
    .catch((error) => {
      throw toLoyaltyError(error);
    });
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
