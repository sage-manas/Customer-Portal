/**
 * Frontend-only stand-in for `@cc/service-payment`.
 *
 * The customer-facing reads (statement, open items to pay, receipt) come
 * from the seeded SAP landscape. The payment *rows* the portal owns live in
 * the demo store, and checkout is the mock-gateway flow /client already had
 * for dev tenants — no real gateway, no webhook, no money.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-payment: Razorpay order creation,
 * signed webhook handling, F-28 posting through the SAP adapter, and the
 * reconciliation sweep.
 */

import {
  agingByCustomer,
  buildAging,
  buildStatement,
  daysOverdue,
  dueInDays,
  dunningCandidates,
  RECONCILIATION_RULES,
  type AgingSummary,
  type CustomerLedgerRow,
  type DunningCandidate,
  type LedgerOpenItem,
  type OpenItem,
  type PaymentMode,
  type PaymentStatus,
  type ReconciliationException,
  type Statement,
  type StatementFilter,
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

export class PaymentError extends DemoServiceError {
  constructor(message: string, code = "payment_error", status = 400) {
    super(message, { code, status });
    this.name = "PaymentError";
  }
}

export function isPaymentError(error: unknown): error is PaymentError {
  return error instanceof PaymentError;
}

export type PaymentErrorCode = string;
export type PaymentIssue = { path: string; message: string };

export function toPaymentReadError(error: unknown): PaymentError {
  if (isPaymentError(error)) return error;
  return new PaymentError(
    "We couldn't read your account position just now. Try again in a moment.",
    "upstream_unavailable",
    502,
  );
}

// ---------------------------------------------------------------------------
// Statement & payables
// ---------------------------------------------------------------------------

export interface StatementResult {
  statement: Statement;
  aging: AgingSummary;
  pendingCount: number;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getStatement(
  adapter: SapAdapter,
  kunnr: string | undefined,
  filter: StatementFilter = {},
  options: { pendingCount?: number } = {},
): Promise<StatementResult> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getOpenItems(account).catch((error) => {
    throw toPaymentReadError(error);
  });

  return {
    statement: buildStatement(read.data, filter),
    aging: buildAging(read.data, DEMO_TODAY),
    pendingCount:
      options.pendingCount ??
      payments().filter(
        (row) => row.kunnr === account && row.status === "captured" && !row.fiDocumentNumber,
      ).length,
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface PayableItem {
  documentNumber: string;
  postingDate: string;
  dueDate: string;
  openAmount: number;
  currency: string;
  dueInDays: number;
  daysOverdue: number;
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

export async function listPayableItems(
  adapter: SapAdapter,
  kunnr: string | undefined,
): Promise<PayableItemsResult> {
  const account = requireDemoKunnr(kunnr);
  const read = await adapter.getOpenItems(account).catch((error) => {
    throw toPaymentReadError(error);
  });

  const items: PayableItem[] = read.data
    .filter((item: OpenItem) => item.openAmount > 0 && item.documentType !== "DZ")
    .map((item) => ({
      documentNumber: item.documentNumber,
      postingDate: item.postingDate,
      dueDate: item.dueDate,
      openAmount: item.openAmount,
      currency: item.currency,
      dueInDays: dueInDays(item.dueDate, DEMO_TODAY),
      daysOverdue: daysOverdue(item.dueDate, DEMO_TODAY),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));

  return {
    items,
    totalOutstanding: round2(items.reduce((sum, item) => sum + item.openAmount, 0)),
    currency: items[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

// ---------------------------------------------------------------------------
// Payments (portal-owned)
// ---------------------------------------------------------------------------

export interface DemoPaymentRecord {
  id: string;
  kunnr: string;
  amount: number;
  currency: string;
  mode: PaymentMode;
  status: PaymentStatus;
  gatewayReference: string;
  fiDocumentNumber?: string;
  allocations: Array<{ documentNumber: string; amount: number }>;
  /** FI items this payment cleared, once SAP posted it. */
  clearedItems: string[];
  /** Why the gateway declined it — shown on the receipt screen. */
  failureReason?: string;
  createdAt: Date;
  completedAt?: Date;
  exception?: ReconciliationException;
}

const payments = () => demoStore().payments as DemoPaymentRecord[];

export interface InitiatedPayment {
  paymentId: string;
  checkoutUrl: string;
  amount: number;
  currency: string;
  gatewayReference: string;
}

export async function initiatePayment(input: {
  tenantId: string;
  kunnr: string | undefined;
  amount: number;
  currency?: string;
  mode?: PaymentMode;
  allocations: Array<{ documentNumber: string; amount: number }>;
  userId?: string;
}): Promise<InitiatedPayment> {
  const account = requireDemoKunnr(input.kunnr);
  const id = `PAY-${String(nextSequence("payment", 1000)).padStart(6, "0")}`;

  payments().push({
    id,
    kunnr: account,
    amount: input.amount,
    currency: input.currency ?? "INR",
    mode: input.mode ?? "netbanking",
    status: "initiated",
    gatewayReference: `demo_${id.toLowerCase()}`,
    allocations: input.allocations,
    clearedItems: [],
    createdAt: new Date(),
  });

  return {
    paymentId: id,
    // The mock gateway is the portal's own receipt screen, exactly as the
    // dev checkout flow works in /client for a `mock`-gateway tenant.
    checkoutUrl: `/payments/${id}/receipt`,
    amount: input.amount,
    currency: input.currency ?? "INR",
    gatewayReference: `demo_${id.toLowerCase()}`,
  };
}

export async function getPayment(
  _tenantId: string,
  kunnr: string | undefined,
  paymentId: string,
): Promise<DemoPaymentRecord> {
  const account = requireDemoKunnr(kunnr);
  const payment = payments().find((row) => row.id === paymentId && row.kunnr === account);
  if (!payment) {
    throw new PaymentError(`We couldn't find payment ${paymentId}.`, "not_found", 404);
  }
  return payment;
}

export async function listPayments(_tenantId: string, kunnr: string | undefined) {
  const account = requireDemoKunnr(kunnr);
  return payments()
    .filter((row) => row.kunnr === account)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function listPendingSync(_tenantId: string, kunnr: string | undefined) {
  const account = requireDemoKunnr(kunnr);
  return payments().filter(
    (row) => row.kunnr === account && row.status === "captured" && !row.fiDocumentNumber,
  );
}

/**
 * The dev-checkout completion /client exposes for mock-gateway tenants:
 * marks the payment captured and posts it to SAP (F-28 equivalent).
 */
export async function completeMockCheckout(
  adapter: SapAdapter,
  input: { tenantId: string; paymentId: string; kunnr: string | undefined; outcome?: "success" | "failure" },
): Promise<DemoPaymentRecord> {
  const payment = await getPayment(input.tenantId, input.kunnr, input.paymentId);

  if (input.outcome === "failure") {
    payment.status = "failed";
    payment.failureReason = "The demo gateway was asked to decline this payment.";
    return payment;
  }

  payment.status = "captured";
  payment.completedAt = new Date();

  const posted = await adapter
    .postIncomingPayment({
      kunnr: payment.kunnr,
      amount: payment.amount,
      currency: payment.currency,
      gatewayReference: payment.gatewayReference,
      allocations: payment.allocations,
    })
    .catch(() => null);

  if (posted) {
    payment.fiDocumentNumber = posted.documentNumber;
    payment.clearedItems = posted.clearedItems;
    payment.status = "posted";
  } else {
    // A capture SAP would not take is the reconciliation tray's whole reason
    // for existing — it is recorded, never silently dropped (docs/07 B4).
    // A capture SAP would not take is the reconciliation tray's whole reason
    // for existing — it is recorded, never silently dropped (docs/07 B4).
    //
    // Built from the rule registry rather than through
    // `classifyPaymentException`: that function only reports a row *stale*
    // past its threshold, and a demo failure has just happened. The label
    // and severity still come from the registry, never from here.
    const rule = RECONCILIATION_RULES.payment_posting_overdue;
    payment.exception = {
      kind: rule.kind,
      label: rule.label,
      severity: rule.severity,
      ageMs: 0,
    };
  }

  return payment;
}

export async function postCapturedPayment(adapter: SapAdapter, paymentId: string, tenantId: string) {
  const payment = payments().find((row) => row.id === paymentId);
  if (!payment) throw new PaymentError("Payment not found", "not_found", 404);
  return completeMockCheckout(adapter, { tenantId, paymentId, kunnr: payment.kunnr });
}

export async function reconcilePayment(adapter: SapAdapter, paymentId: string, tenantId: string) {
  return postCapturedPayment(adapter, paymentId, tenantId);
}

export interface WebhookResult {
  applied: boolean;
  paymentId?: string;
  status?: PaymentStatus;
  fiDocumentNumber?: string;
}

export async function handleGatewayWebhook(): Promise<WebhookResult> {
  // TODO(BACKEND):
  // The real handler verifies an HMAC signature over the raw body before
  // parsing it (docs/02 §6). There is no gateway in demo mode.
  return { applied: false };
}

// ---------------------------------------------------------------------------
// Reconciliation tray (AP desk)
// ---------------------------------------------------------------------------

export interface PaymentException {
  paymentId: string;
  kunnr: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  gatewayReference?: string;
  exception: ReconciliationException;
}

export async function listPaymentExceptions(
  _tenantId: string,
  _now?: Date,
): Promise<PaymentException[]> {
  return payments()
    .filter((row) => row.exception)
    .map((row) => ({
      paymentId: row.id,
      kunnr: row.kunnr,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      gatewayReference: row.gatewayReference,
      exception: row.exception!,
    }));
}

export function getPaymentGatewayForTenant(_tenantId: string): null {
  // TODO(BACKEND): resolves the tenant's gateway from the credential vault.
  return null;
}

export function isPaymentGatewayError(_error: unknown): boolean {
  return false;
}

export type GatewayPaymentStatus = PaymentStatus;
export type PaymentGateway = unknown;

// ---------------------------------------------------------------------------
// Ledger (tenant-wide, AR desk)
// ---------------------------------------------------------------------------

export interface TenantLedgerResult {
  items: LedgerOpenItem[];
  /** Aging across the whole tenant — the bar at the top of the desk. */
  aging: AgingSummary;
  /** Per-account rows, built by @cc/domain's `agingByCustomer`. */
  customers: CustomerLedgerRow[];
  totalOutstanding: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function getTenantLedger(adapter: SapAdapter): Promise<TenantLedgerResult> {
  const read = await adapter.getOpenItemsLedger().catch((error) => {
    throw toPaymentReadError(error);
  });

  return {
    items: read.data,
    aging: buildAging(read.data, DEMO_TODAY),
    customers: agingByCustomer(read.data, DEMO_TODAY),
    totalOutstanding: round2(read.data.reduce((sum, item) => sum + item.openAmount, 0)),
    currency: read.data[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface DunningResult {
  candidates: DunningCandidate[];
  /** Overdue value across every candidate — what the desk is chasing. */
  totalOverdue: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

export interface PaymentsReceivedResult {
  payments: DemoPaymentRecord[];
  totalReceived: number;
  /** Captured by the gateway but not yet cleared in FI (ADR-019). */
  pendingSyncCount: number;
  currency: string;
  freshness: FreshnessClass;
  syncedAt: string;
}

/**
 * What the portal took, not what FI holds — ADR-019's distinction, and the
 * reason this reads the payment rows rather than the ledger.
 */
export async function listPaymentsReceived(
  _tenantId: string,
): Promise<PaymentsReceivedResult> {
  const rows = [...payments()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    payments: rows,
    totalReceived: round2(
      rows
        .filter((row) => row.status === "captured" || row.status === "posted")
        .reduce((sum, row) => sum + row.amount, 0),
    ),
    pendingSyncCount: rows.filter((row) => row.status === "captured" && !row.fiDocumentNumber)
      .length,
    currency: rows[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export async function listDunningCandidates(adapter: SapAdapter): Promise<DunningResult> {
  const read = await adapter.getOpenItemsLedger().catch((error) => {
    throw toPaymentReadError(error);
  });

  const candidates = dunningCandidates(read.data, DEMO_TODAY);
  return {
    candidates,
    totalOverdue: round2(candidates.reduce((sum, row) => sum + row.overdueAmount, 0)),
    currency: read.data[0]?.currency ?? "INR",
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
