import type { CacheStore } from "@cc/adapter-cache";
import { earliestSyncedAt, isSapError, leastFresh, type SapAdapter } from "@cc/adapter-sap";
import type { MonthBucket, OnTimeDelivery, ProductRow, ReportRange, SalesKpis } from "@cc/domain";
import {
  aovTrend,
  DEFAULT_REPORT_PERIOD,
  isReportPeriodKey,
  ordersByMonth,
  REPORT_CACHE_TTL_SECONDS,
  reportRange,
  salesKpis,
  topProducts,
  TOP_PRODUCTS_LIMIT,
} from "@cc/domain";

import { cacheAside, getReportCache, type Cached } from "./cache";
import { ReportingError } from "./errors";

/**
 * Sales dashboard (docs/03 Module 10, docs/05 §7.10).
 *
 * The module stores nothing, and unlike A5 it does not even have a row on
 * the side: every figure is an aggregate over documents SAP owns, composed
 * per read and cached rather than projected (ADR-037). The aggregation
 * itself is not here — it is in `@cc/domain/entities/reporting`, so the
 * chart, the KPI tile and the CSV cannot bucket a month three different
 * ways (ADR-015's rule, applied to arithmetic).
 *
 * **The sold-to account is the boundary**, as everywhere else: every read
 * below is a KUNNR-scoped adapter method taken from the session, and there
 * is deliberately no tenant-wide variant. A back-office sales report would
 * need its own adapter methods, not these with the account left off — that
 * is ADR-032, and it is why this file has no `getSalesReportForDesk`.
 */

export interface ReportingContext {
  tenantId: string;
  kunnr: string;
}

export interface SalesReport {
  range: ReportRange;
  kpis: SalesKpis;
  ordersByMonth: MonthBucket[];
  aov: MonthBucket[];
  topProducts: ProductRow[];
  onTime: OnTimeDelivery;
}

export interface SalesReportOptions {
  /** Query-string value; validated here rather than by every caller. */
  period?: string;
  /** Injected so tests are deterministic; defaults to now. */
  today?: string;
  /** The "Refresh" button — recompute and rewrite the entry. */
  refresh?: boolean;
  store?: CacheStore;
}

export async function getSalesReport(
  adapter: SapAdapter,
  context: ReportingContext,
  options: SalesReportOptions = {},
): Promise<Cached<SalesReport>> {
  if (!context.kunnr) throw new ReportingError("no_account");

  const today = (options.today ?? new Date().toISOString()).slice(0, 10);
  const periodKey = resolvePeriod(options.period);
  const range = reportRange(periodKey, today);

  return cacheAside<SalesReport>({
    store: options.store ?? getReportCache(),
    tenantId: context.tenantId,
    namespace: "reports.sales",
    // The KUNNR is part of the key, not an assumption about who is asking —
    // two customers on one tenant must never share an entry.
    parts: [context.kunnr, periodKey, today],
    ttlSeconds: REPORT_CACHE_TTL_SECONDS["reports.sales"],
    bypass: options.refresh,
    load: async () => {
      try {
        const [orders, invoices, deliveries] = await Promise.all([
          adapter.getOrders(context.kunnr),
          adapter.getInvoices(context.kunnr),
          adapter.getDeliveries(context.kunnr),
        ]);

        const reads = [orders, invoices, deliveries];
        const buckets = ordersByMonth(orders.data.items, range);
        const kpis = salesKpis({
          orders: orders.data.items,
          invoices: invoices.data.items,
          deliveries: deliveries.data.items,
          range,
          today,
        });

        return {
          data: {
            range,
            kpis,
            ordersByMonth: buckets,
            aov: aovTrend(buckets),
            topProducts: topProducts(orders.data.items, range, TOP_PRODUCTS_LIMIT),
            onTime: kpis.onTime,
          },
          // A composite is only as fresh as its least-fresh part, and it is
          // only as current as its *earliest* read — claiming the newest
          // timestamp would date the whole page by its luckiest call.
          freshness: leastFresh(reads),
          syncedAt: earliestSyncedAt(reads),
        };
      } catch (error) {
        if (isSapError(error) && error.kind === "unavailable") {
          throw new ReportingError("upstream_unavailable", undefined, { cause: error });
        }
        throw error;
      }
    },
  });
}

export function resolvePeriod(period: string | undefined) {
  if (period === undefined) return DEFAULT_REPORT_PERIOD;
  if (!isReportPeriodKey(period)) throw new ReportingError("invalid_period");
  return period;
}
