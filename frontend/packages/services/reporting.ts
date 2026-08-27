/**
 * Frontend-only stand-in for `@cc/service-reporting`.
 *
 * The real package is cache-aside over Redis (ADR-036) and composes SAP
 * reads; this one keeps the composition and drops the cache. Every figure is
 * derived by the *domain's own* helpers (`salesKpis`, `ordersByMonth`,
 * `topProducts`, `buildAging`, …) exactly as the real service does, so the
 * dashboard, the sales report and the AR report agree with each other and
 * with the Orders/Invoices screens.
 *
 * `Cached<T>` is preserved as the return shape, including `freshness` and
 * `syncedAt`, because the screens render a `SapSyncIndicator` from it.
 * Demo mode is always `live` — there is no cache to be stale against.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-reporting + @cc/adapter-cache.
 */

import {
  AGING_BUCKETS,
  agingBucketFor,
  aovTrend,
  buildAging,
  daysOverdue,
  isReportPeriodKey,
  ordersByMonth,
  onTimeDelivery,
  reportRange,
  salesKpis,
  topProducts,
  type AgingBucketKey,
  type AgingSummary,
  type Invoice,
  type MonthBucket,
  type OnTimeDelivery,
  type OpenItem,
  type OrderStatusView,
  type ProductRow,
  type ReportRange,
  type SalesKpis,
} from "@cc/domain";

import { DemoServiceError, DEMO_FRESHNESS, DEMO_TODAY, demoSyncedAt } from "./_demo";

import type { CreditInfo } from "@cc/domain";
import type { FreshnessClass, SapAdapter } from "../sap-mock";

/** Mirrors `ReportingError` so the pages' `isReportingError` guards work. */
export class ReportingError extends DemoServiceError {
  constructor(message: string, code = "reporting_error", status = 502) {
    super(message, { code, status });
    this.name = "ReportingError";
  }
}

export function isReportingError(error: unknown): error is ReportingError {
  return error instanceof ReportingError;
}

export type ReportingErrorCode = string;

export interface ReportingContext {
  tenantId: string;
  kunnr: string;
}

export interface Cached<T> {
  data: T;
  freshness: FreshnessClass;
  syncedAt: string;
}

function live<T>(data: T): Cached<T> {
  return { data, freshness: DEMO_FRESHNESS, syncedAt: demoSyncedAt() };
}

/** SAP outages degrade the report rather than 500 it (doc 05 P7). */
async function readOrFail<T>(read: () => Promise<T>, what: string): Promise<T> {
  try {
    return await read();
  } catch {
    throw new ReportingError(
      `We couldn't read your ${what} from SAP just now. Try again in a moment.`,
      "upstream_unavailable",
      502,
    );
  }
}

// ---------------------------------------------------------------------------
// Dashboard (docs/05 §7.0)
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  openOrders: { count: number; value: number };
  pendingInvoices: { count: number; value: number };
  credit: CreditInfo | null;
  openTickets: number | null;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  recentOrders: OrderStatusView[];
  recentInvoices: Invoice[];
  hasCreditHold: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
  currency: string;
}

export async function getDashboardSummary(
  adapter: SapAdapter,
  kunnr: string,
): Promise<DashboardSummary> {
  const [orders, invoices, deliveries, credit] = await Promise.all([
    readOrFail(() => adapter.getOrders(kunnr), "orders"),
    readOrFail(() => adapter.getInvoices(kunnr), "invoices"),
    readOrFail(() => adapter.getDeliveries(kunnr), "deliveries"),
    adapter.getCreditInfo(kunnr).catch(() => null),
  ]);

  const orderRows = orders.data.items;
  const invoiceRows = invoices.data.items;
  const range = reportRange("last-12-months", DEMO_TODAY);
  const kpis = salesKpis({
    orders: orderRows,
    invoices: invoiceRows,
    deliveries: deliveries.data.items,
    range,
    today: DEMO_TODAY,
  });

  return {
    kpis: {
      openOrders: kpis.openOrders,
      pendingInvoices: kpis.pendingInvoices,
      credit: credit?.data ?? null,
      // TODO(BACKEND):
      // The real service counts open tickets from the portal's own ticket
      // table. `null` renders the same "arrives in a later phase" subline
      // /client shows when Support has no count to give.
      openTickets: null,
    },
    recentOrders: [...orderRows].sort(byDateDesc("createdOn")).slice(0, 5),
    recentInvoices: [...invoiceRows].sort(byDateDesc("billingDate")).slice(0, 5),
    hasCreditHold: orderRows.some((order) => order.creditStatus === "CreditHold"),
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
    currency: kpis.currency,
  };
}

function byDateDesc<K extends string>(key: K) {
  return (a: Record<K, string>, b: Record<K, string>) => b[key].localeCompare(a[key]);
}

// ---------------------------------------------------------------------------
// Sales report (docs/03 Module 10, docs/05 §7.10)
// ---------------------------------------------------------------------------

export interface SalesReport {
  range: ReportRange;
  kpis: SalesKpis;
  ordersByMonth: MonthBucket[];
  aov: MonthBucket[];
  topProducts: ProductRow[];
  onTime: OnTimeDelivery;
}

export interface SalesReportOptions {
  period?: string;
  today?: string;
  refresh?: boolean;
  store?: unknown;
}

export function resolvePeriod(period: string | undefined): ReportRange {
  const key = period && isReportPeriodKey(period) ? period : "last-6-months";
  return reportRange(key, DEMO_TODAY);
}

export async function getSalesReport(
  adapter: SapAdapter,
  context: ReportingContext,
  options: SalesReportOptions = {},
): Promise<Cached<SalesReport>> {
  const today = options.today ?? DEMO_TODAY;
  const range = resolvePeriod(options.period);

  const [orders, invoices, deliveries] = await Promise.all([
    readOrFail(() => adapter.getOrders(context.kunnr), "orders"),
    readOrFail(() => adapter.getInvoices(context.kunnr), "invoices"),
    readOrFail(() => adapter.getDeliveries(context.kunnr), "deliveries"),
  ]);

  const orderRows = orders.data.items;
  const buckets = ordersByMonth(orderRows, range);

  return live({
    range,
    kpis: salesKpis({
      orders: orderRows,
      invoices: invoices.data.items,
      deliveries: deliveries.data.items,
      range,
      today,
    }),
    ordersByMonth: buckets,
    aov: aovTrend(buckets),
    topProducts: topProducts(orderRows, range),
    onTime: onTimeDelivery(deliveries.data.items, range),
  });
}

// ---------------------------------------------------------------------------
// AR summary (docs/05 §7.10)
// ---------------------------------------------------------------------------

export interface AgingBucketRow {
  documentNumber: string;
  documentType: string;
  postingDate: string;
  dueDate: string;
  openAmount: number;
  currency: string;
  daysOverdue: number;
  isInvoice: boolean;
}

export interface ArSummary {
  aging: AgingSummary;
  documents: Record<AgingBucketKey, AgingBucketRow[]>;
  today: string;
  currency: string;
}

export interface ArSummaryOptions {
  today?: string;
  refresh?: boolean;
  store?: unknown;
}

export async function getArSummary(
  adapter: SapAdapter,
  context: ReportingContext,
  options: ArSummaryOptions = {},
): Promise<Cached<ArSummary>> {
  const today = options.today ?? DEMO_TODAY;
  const read = await readOrFail(() => adapter.getOpenItems(context.kunnr), "account position");
  const items = read.data.filter((item) => item.openAmount > 0);

  const documents = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket.key, [] as AgingBucketRow[]]),
  ) as Record<AgingBucketKey, AgingBucketRow[]>;

  for (const item of items) {
    documents[agingBucketFor(item.dueDate, today)].push(toBucketRow(item, today));
  }

  for (const rows of Object.values(documents)) {
    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  return live({
    aging: buildAging(items, today, items[0]?.currency ?? "INR"),
    documents,
    today,
    currency: items[0]?.currency ?? "INR",
  });
}

function toBucketRow(item: OpenItem, today: string): AgingBucketRow {
  return {
    documentNumber: item.documentNumber,
    documentType: item.documentType,
    postingDate: item.postingDate,
    dueDate: item.dueDate,
    openAmount: item.openAmount,
    currency: item.currency,
    daysOverdue: daysOverdue(item.dueDate, today),
    // BKPF-BLART RV is the billing document; DZ/G2 are payments and notes.
    isInvoice: item.documentType === "RV",
  };
}

// ---------------------------------------------------------------------------

export function getReportCache(): undefined {
  // TODO(BACKEND): the real cache is Redis-backed (@cc/adapter-cache, ADR-036).
  return undefined;
}

export function invalidateTenantReports(_tenantId: string): void {
  /* Nothing to invalidate in demo mode. */
}
