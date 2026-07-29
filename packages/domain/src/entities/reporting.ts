import { fiscalYearRange, type FiscalYearRange } from "./loyalty";
import type { Delivery, Invoice, OrderStatusView } from "./sales-doc";

/**
 * Reporting and analytics — docs/03 Module 10, docs/05 §7.10.
 *
 * Every number on the reports screens is computed here, from documents SAP
 * returned, and rendered by a chart that decides nothing. That is ADR-015's
 * rule for the O2C timeline and ADR-018's for aging arithmetic, applied to
 * the last module that could plausibly have put a `reduce()` in a component:
 * a chart and a KPI tile showing the same quantity must be able to disagree
 * only if the *data* differs, never because two files bucketed months
 * differently.
 *
 * Nothing here reads or writes anything. These are pure functions over
 * arrays, which is why a report can be cached (ADR-037) without a cache
 * ever holding something only a report knows.
 */

// ---- The reporting period (a registry, not a set of magic numbers) --------

export type ReportPeriodKey = "last-3-months" | "last-6-months" | "last-12-months" | "fiscal-year";

export interface ReportPeriodDef {
  key: ReportPeriodKey;
  label: string;
  /**
   * Whole months back from the current month, inclusive of it. `undefined`
   * means the range is the fiscal year, resolved against `today`.
   */
  months?: number;
}

/**
 * The periods the reports screens offer. Doc 05 §7.10 asks for a 12-month
 * bar chart and doc 03 for a YTD figure; the shorter windows exist because
 * a monthly chart of a customer who buys weekly is unreadable at 12 bars.
 */
export const REPORT_PERIODS: readonly ReportPeriodDef[] = [
  { key: "last-3-months", label: "Last 3 months", months: 3 },
  { key: "last-6-months", label: "Last 6 months", months: 6 },
  { key: "last-12-months", label: "Last 12 months", months: 12 },
  { key: "fiscal-year", label: "This fiscal year" },
] as const;

export const DEFAULT_REPORT_PERIOD: ReportPeriodKey = "last-12-months";

export function isReportPeriodKey(value: string): value is ReportPeriodKey {
  return REPORT_PERIODS.some((period) => period.key === value);
}

export interface ReportRange {
  key: ReportPeriodKey;
  /** Inclusive ISO date. */
  from: string;
  /** Inclusive ISO date — `today`, never the end of the current month. */
  to: string;
  label: string;
}

/**
 * Resolves a period against a date. The window always *ends today* rather
 * than at the end of the current month: a chart whose last bar covers a
 * month that hasn't happened yet reads as a collapse in demand.
 */
export function reportRange(key: ReportPeriodKey, todayIso: string): ReportRange {
  const today = todayIso.slice(0, 10);
  const def = REPORT_PERIODS.find((period) => period.key === key);

  if (!def || def.months === undefined) {
    const fy: FiscalYearRange = fiscalYearRange(today);
    return {
      key: "fiscal-year",
      from: fy.start,
      // A fiscal year that has not finished ends today, for the reason above.
      to: today < fy.end ? today : fy.end,
      label: fy.label,
    };
  }

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // months - 1, because the window includes the current month.
  const start = new Date(Date.UTC(year, month - 1 - (def.months - 1), 1));

  return {
    key: def.key,
    from: start.toISOString().slice(0, 10),
    to: today,
    label: def.label,
  };
}

export function isWithinRange(iso: string | undefined, range: ReportRange): boolean {
  if (!iso) return false;
  const date = iso.slice(0, 10);
  return date >= range.from && date <= range.to;
}

// ---- Month buckets --------------------------------------------------------

export interface MonthBucket {
  /** `YYYY-MM` — the sort key and the chart's data key. */
  key: string;
  /** `Apr 25` — what the axis prints (docs/05 §11 date style). */
  label: string;
  orderCount: number;
  value: number;
  /** Mean order value for the month; 0 when nothing was ordered. */
  averageOrderValue: number;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7));
  const name = MONTH_NAMES[month - 1] ?? key.slice(5, 7);
  return `${name} ${key.slice(2, 4)}`;
}

/**
 * Every month in the range, in order, including the ones with nothing in
 * them. A chart built from only the months that have data draws a straight
 * line through a quarter of silence and calls it steady trading — the empty
 * months are the finding.
 */
export function monthsInRange(range: ReportRange): string[] {
  const keys: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7));
  const last = monthKey(range.to);

  for (let guard = 0; guard < 240; guard += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    keys.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

/**
 * Orders that count towards a sales figure.
 *
 * A fully rejected order — every item carrying VBAP-ABGRU, which is what
 * ADR-017's cancellation produces — is excluded. It is a document SAP still
 * holds and the orders list still shows, but it is not demand: counting it
 * would let a customer's chart rise by cancelling things.
 */
export function isReportableOrder(order: Pick<OrderStatusView, "orderStatus">): boolean {
  return order.orderStatus !== "Rejected";
}

/** Docs/03 Module 10: "Orders by month (VBAK-ERDAT)". */
export function ordersByMonth(
  orders: readonly OrderStatusView[],
  range: ReportRange,
): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>(
    monthsInRange(range).map((key) => [
      key,
      { key, label: monthLabel(key), orderCount: 0, value: 0, averageOrderValue: 0 },
    ]),
  );

  for (const order of orders) {
    if (!isReportableOrder(order)) continue;
    if (!isWithinRange(order.createdOn, range)) continue;
    const bucket = buckets.get(monthKey(order.createdOn));
    if (!bucket) continue;
    bucket.orderCount += 1;
    bucket.value = round2(bucket.value + order.netValue);
  }

  for (const bucket of buckets.values()) {
    bucket.averageOrderValue = bucket.orderCount > 0 ? round2(bucket.value / bucket.orderCount) : 0;
  }

  return [...buckets.values()];
}

/**
 * Docs/05 §7.10 lists "AOV trend" as its own chart. It is derived from the
 * month buckets rather than recomputed, so the two charts cannot disagree
 * about which month an order fell in.
 */
export function aovTrend(buckets: readonly MonthBucket[]): MonthBucket[] {
  return buckets.map((bucket) => ({ ...bucket }));
}

// ---- Top products ---------------------------------------------------------

export interface ProductRow {
  /** VBAP-MATNR */
  material: string;
  description?: string;
  quantity: number;
  uom: string;
  value: number;
  orderCount: number;
}

export const TOP_PRODUCTS_LIMIT = 10;

/**
 * Docs/03 Module 10: "Top products (VBAP-MATNR grouped)".
 *
 * Grouped from *order* lines, not billing lines, because a `VBRK` invoice on
 * this contract carries no line items — `Invoice` is a header with tax
 * conditions (ADR-018), and inventing a line-level billing read to answer a
 * chart would add a contract method the ECC/S4 drivers owe in Phase 7 for no
 * reason. Doc 03 names VBAP for exactly this figure, so the sources agree.
 *
 * A line's UoM is taken from its first appearance: a material sold in two
 * units of measure cannot be summed into one quantity honestly, and the
 * value column — which is always comparable — is what the chart ranks on.
 */
export function topProducts(
  orders: readonly OrderStatusView[],
  range: ReportRange,
  limit: number = TOP_PRODUCTS_LIMIT,
): ProductRow[] {
  const rows = new Map<string, ProductRow & { orders: Set<string> }>();

  for (const order of orders) {
    if (!isReportableOrder(order)) continue;
    if (!isWithinRange(order.createdOn, range)) continue;

    for (const line of order.lines) {
      const existing = rows.get(line.material);
      if (existing) {
        existing.quantity = round2(existing.quantity + line.quantity);
        existing.value = round2(existing.value + line.netValue);
        existing.description ??= line.description;
        existing.orders.add(order.vbeln);
      } else {
        rows.set(line.material, {
          material: line.material,
          description: line.description,
          quantity: line.quantity,
          uom: line.uom,
          value: line.netValue,
          orderCount: 0,
          orders: new Set([order.vbeln]),
        });
      }
    }
  }

  return [...rows.values()]
    .map(({ orders: orderSet, ...row }) => ({ ...row, orderCount: orderSet.size }))
    .sort((a, b) => b.value - a.value || a.material.localeCompare(b.material))
    .slice(0, limit);
}

// ---- On-time delivery -----------------------------------------------------

export interface OnTimeDelivery {
  /** Deliveries that have actually gone out — the denominator. */
  shipped: number;
  onTime: number;
  late: number;
  /** Despatched, but with no planned date to judge against. */
  unmeasured: number;
  /** Not yet goods-issued, so not yet on time or late. */
  pending: number;
  /** 0–100, or null when nothing measurable shipped in the range. */
  ratePercent: number | null;
}

/**
 * Docs/03 Module 10: "On-time delivery % (LIKP WADAT vs WADAT_IST)".
 *
 * A delivery is judged only once it has been goods-issued, and only when SAP
 * gave it a planned date to be judged against. Both exclusions matter: an
 * in-flight shipment that will arrive tomorrow is not late today, and
 * scoring a delivery with no WADAT as on-time would let a tenant's OTD rise
 * by not planning. Those two populations are reported separately rather than
 * folded into the denominator, so the percentage always says what it covers.
 */
export function onTimeDelivery(
  deliveries: readonly Delivery[],
  range: ReportRange,
): OnTimeDelivery {
  let shipped = 0;
  let onTime = 0;
  let late = 0;
  let unmeasured = 0;
  let pending = 0;

  for (const delivery of deliveries) {
    if (!delivery.actualGoodsIssue) {
      // Judge a not-yet-shipped delivery by when it was *meant* to ship, so
      // it lands in the range a reader expects.
      if (isWithinRange(delivery.plannedGoodsIssue, range)) pending += 1;
      continue;
    }
    if (!isWithinRange(delivery.actualGoodsIssue, range)) continue;

    if (!delivery.plannedGoodsIssue) {
      unmeasured += 1;
      continue;
    }

    shipped += 1;
    if (delivery.actualGoodsIssue.slice(0, 10) <= delivery.plannedGoodsIssue.slice(0, 10)) {
      onTime += 1;
    } else {
      late += 1;
    }
  }

  return {
    shipped,
    onTime,
    late,
    unmeasured,
    pending,
    ratePercent: shipped > 0 ? Math.round((onTime / shipped) * 1000) / 10 : null,
  };
}

// ---- The KPI row ----------------------------------------------------------

export interface SalesKpis {
  /** Σ VBRK-NETWR over the fiscal year (docs/03 Module 10: "YTD purchases"). */
  ytdPurchases: number;
  fiscalYear: FiscalYearRange;
  /** Value ordered in the selected range — not the same question as YTD. */
  periodValue: number;
  periodOrderCount: number;
  averageOrderValue: number;
  openOrders: { count: number; value: number };
  pendingInvoices: { count: number; value: number };
  onTime: OnTimeDelivery;
  currency: string;
}

/**
 * `Invoice` values used for a purchase total are gross of nothing and net of
 * tax: doc 03 says Σ VBRK-NETWR, which is the taxable amount, and a "what
 * did I buy this year" figure that included GST would not reconcile against
 * the tier ladder in `@cc/domain/entities/loyalty` — which uses the same
 * field (ADR-034). Credit notes carry negative amounts and therefore reduce
 * the total by arithmetic rather than by a special case (ADR-020).
 */
export function purchaseTotal(invoices: readonly Invoice[], from: string, to: string): number {
  let total = 0;
  for (const invoice of invoices) {
    const date = invoice.billingDate.slice(0, 10);
    if (date < from || date > to) continue;
    total = round2(total + invoice.taxableAmount);
  }
  return total;
}

export function salesKpis(input: {
  orders: readonly OrderStatusView[];
  invoices: readonly Invoice[];
  deliveries: readonly Delivery[];
  range: ReportRange;
  today: string;
  currency?: string;
}): SalesKpis {
  const { orders, invoices, deliveries, range, today } = input;
  const fiscalYear = fiscalYearRange(today);

  const inRange = orders.filter(
    (order) => isReportableOrder(order) && isWithinRange(order.createdOn, range),
  );
  const periodValue = inRange.reduce((sum, order) => round2(sum + order.netValue), 0);

  const openOrders = orders.filter(
    (order) => order.orderStatus !== "Closed" && order.orderStatus !== "Rejected",
  );
  const pendingInvoices = invoices.filter(
    (invoice) => invoice.status === "Open" || invoice.status === "Overdue",
  );

  return {
    ytdPurchases: purchaseTotal(invoices, fiscalYear.start, fiscalYear.end),
    fiscalYear,
    periodValue,
    periodOrderCount: inRange.length,
    averageOrderValue: inRange.length > 0 ? round2(periodValue / inRange.length) : 0,
    openOrders: {
      count: openOrders.length,
      value: openOrders.reduce((sum, order) => round2(sum + order.netValue), 0),
    },
    pendingInvoices: {
      count: pendingInvoices.length,
      value: pendingInvoices.reduce((sum, invoice) => round2(sum + invoice.grossAmount), 0),
    },
    onTime: onTimeDelivery(deliveries, range),
    currency: input.currency ?? invoices.find((invoice) => invoice.currency)?.currency ?? "INR",
  };
}

// ---- Cache TTLs (a registry, per docs/02 §4.3 "per-entity TTLs") ----------

export const REPORT_CACHE_NAMESPACES = ["reports.sales", "reports.ar"] as const;

export type ReportCacheNamespace = (typeof REPORT_CACHE_NAMESPACES)[number];

/**
 * How long a derived report may be served from cache, per report rather than
 * one number for the module — docs/02 §4.3 asks for per-entity TTLs and the
 * two reports answer questions with different tolerances.
 *
 * The AR summary is the shorter of the two on purpose: it is the screen a
 * customer looks at *while deciding what to pay*, and a five-minute-old
 * balance can be a payment they made in the meantime. The sales dashboard is
 * a trend, and a trend does not change in fifteen minutes.
 *
 * Neither figure is a licence to serve stale data silently — a cached read
 * carries `freshness: "cached"` and its original `syncedAt`, and the screen
 * renders both (ADR-036).
 */
export const REPORT_CACHE_TTL_SECONDS: Record<ReportCacheNamespace, number> = {
  "reports.sales": 15 * 60,
  "reports.ar": 2 * 60,
};

/**
 * Bumped when the *shape* of any cached report changes. One number for the
 * module, because a deploy ships all of it at once and a per-report version
 * is a thing to forget.
 */
export const REPORT_CACHE_VERSION = 1;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
