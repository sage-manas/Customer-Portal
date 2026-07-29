import { isSapError, type FreshnessClass, type SapAdapter } from "@cc/adapter-sap";
import type { CreditInfo, Invoice, OrderStatusView } from "@cc/domain";

/**
 * Customer dashboard summary (docs/05-UI-UX-DESIGN.md §7.0: KPI row +
 * recent orders + recent invoices).
 *
 * It lived in `@cc/service-sap` from Phase 1, because the dashboard was the
 * first screen that needed composed SAP reads and the reporting module did
 * not exist. A6 built that module and this moved here, which is what the
 * comment in the old location promised: the return shape was the contract,
 * so the move is an import line on one page and nothing else.
 *
 * It is deliberately **not** cached, unlike the two reports next to it. The
 * dashboard is the landing screen a customer opens to see whether anything
 * changed since they last looked, and answering that from a fifteen-minute
 * cache is answering a different question. ADR-037's TTLs are for trends.
 *
 * Degradation is deliberate (docs/05 P7): if SAP is unreachable the call
 * returns an empty-but-valid summary flagged `stale` rather than throwing,
 * so the dashboard renders with the outage banner instead of a 500.
 */

export interface DashboardKpis {
  openOrders: { count: number; value: number };
  pendingInvoices: { count: number; value: number };
  credit: CreditInfo | null;
  /** Support module lands in Phase 6; null means "not available yet". */
  openTickets: number | null;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  recentOrders: OrderStatusView[];
  recentInvoices: Invoice[];
  /** True when any order is on credit hold — drives the alert banner. */
  hasCreditHold: boolean;
  freshness: FreshnessClass;
  syncedAt: string;
  currency: string;
}

const RECENT_ROWS = 5;

function emptySummary(): DashboardSummary {
  return {
    kpis: {
      openOrders: { count: 0, value: 0 },
      pendingInvoices: { count: 0, value: 0 },
      credit: null,
      openTickets: null,
    },
    recentOrders: [],
    recentInvoices: [],
    hasCreditHold: false,
    freshness: "stale",
    syncedAt: new Date().toISOString(),
    currency: "INR",
  };
}

export async function getDashboardSummary(
  adapter: SapAdapter,
  kunnr: string,
): Promise<DashboardSummary> {
  try {
    const [orders, invoices, credit] = await Promise.all([
      adapter.getOrders(kunnr),
      adapter.getInvoices(kunnr),
      adapter.getCreditInfo(kunnr),
    ]);

    const openOrders = orders.data.items.filter(
      (order) => order.orderStatus !== "Closed" && order.orderStatus !== "Rejected",
    );
    const pendingInvoices = invoices.data.items.filter(
      (invoice) => invoice.status === "Open" || invoice.status === "Overdue",
    );

    return {
      kpis: {
        openOrders: {
          count: openOrders.length,
          value: openOrders.reduce((sum, order) => sum + order.netValue, 0),
        },
        pendingInvoices: {
          count: pendingInvoices.length,
          value: pendingInvoices.reduce((sum, invoice) => sum + invoice.grossAmount, 0),
        },
        credit: credit.data,
        openTickets: null,
      },
      recentOrders: orders.data.items.slice(0, RECENT_ROWS),
      recentInvoices: invoices.data.items.slice(0, RECENT_ROWS),
      hasCreditHold: orders.data.items.some((order) => order.creditStatus === "CreditHold"),
      // The composite is only as fresh as its least-fresh part.
      freshness: [orders, invoices, credit].some((read) => read.freshness === "stale")
        ? "stale"
        : [orders, invoices, credit].some((read) => read.freshness === "cached")
          ? "cached"
          : "live",
      syncedAt: orders.syncedAt,
      currency: credit.data.currency,
    };
  } catch (error) {
    // Only a connectivity failure degrades; a validation/not-found bug
    // should still surface loudly rather than render a blank dashboard.
    if (isSapError(error) && (error.kind === "unavailable" || error.kind === "not_implemented")) {
      return emptySummary();
    }
    throw error;
  }
}
