import { hasPermission, type ReportPeriodKey } from "@cc/domain";
import { getSalesReport, isReportingError } from "@cc/service-reporting";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  AovTrendChart,
  KpiCard,
  Money,
  OrdersByMonthChart,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  TopProductsChart,
} from "@cc/ui";
import { Package, Receipt, Truck, TrendingUp } from "lucide-react";
import { redirect } from "next/navigation";

import { ReportControls } from "./ReportControls";
import { ReportTabs } from "./ReportTabs";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Sales dashboard (docs/03 Module 10, docs/05 §7.10).
 *
 * Every figure is composed from SAP reads on request and stored nowhere
 * (ADR-037). What *is* different from every other screen in the portal is
 * that this one is usually answered from a cache — so the freshness in the
 * header is normally `cached` with a real "synced" time, and the refresh
 * control next to it is the reader's way of asking for a live read. A
 * screen that hid that would be the silent mirror ADR-016 exists to
 * prevent; here it is simply on the page.
 *
 * The charts receive arrays `@cc/domain` already shaped. Nothing on this
 * page buckets a month or sums a line.
 */

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Hiding the nav item is presentation; this is the control (docs/05 §4.3).
  if (!hasPermission(session, "report:view")) redirect("/403");

  const params = await searchParams;
  const period = single(params.period);
  const refresh = single(params.refresh) === "1";

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Reports" />
        <ReportTabs />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there&apos;s nothing to report on.
          Ask your administrator to link one.
        </p>
      </>
    );
  }

  const kunnr = session.kunnr;
  const adapter = await getSapAdapterForTenant(session.tenantId);

  const result = await safeRead(async () => {
    try {
      const report = await getSalesReport(
        adapter,
        { tenantId: session.tenantId, kunnr },
        { period, refresh },
      );
      return { report, loadError: undefined };
    } catch (error) {
      // Doc 05 P7: a SAP outage degrades the page, it does not 500 it. The
      // charts render their error state and say what happened.
      if (!isReportingError(error)) throw error;
      return { report: undefined, loadError: error.message };
    }
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Reports" />
        <ReportTabs />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const { report, loadError } = result.data;

  const activePeriod: ReportPeriodKey = report?.data.range.key ?? "last-12-months";
  const kpis = report?.data.kpis;

  return (
    <>
      {report?.freshness === "stale" ? <StaleDataBanner syncedAt={report.syncedAt} /> : null}

      <PageHeader
        title="Reports"
        subtitle={
          report
            ? `Sales activity for account ${session.kunnr}, ${report.data.range.label}.`
            : undefined
        }
        meta={
          report ? (
            <SapSyncIndicator state={report.freshness} syncedAt={report.syncedAt} />
          ) : undefined
        }
      />

      <ReportTabs />

      <ReportControls active={activePeriod} basePath="/reports" />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`Purchases ${kpis?.fiscalYear.label ?? ""}`.trim()}
          value={kpis ? <Money value={kpis.ytdPurchases} /> : "—"}
          subline="Billed value, excluding GST"
          icon={TrendingUp}
          accent="report"
        />
        <KpiCard
          label="Open orders"
          value={kpis?.openOrders.count ?? "—"}
          subline={kpis ? <Money value={kpis.openOrders.value} /> : undefined}
          icon={Package}
          accent="order"
          href="/orders"
        />
        <KpiCard
          label="Pending invoices"
          value={kpis?.pendingInvoices.count ?? "—"}
          subline={kpis ? <Money value={kpis.pendingInvoices.value} /> : undefined}
          icon={Receipt}
          accent="invoice"
          href="/reports/ar"
        />
        <KpiCard
          label="On-time delivery"
          value={
            kpis?.onTime.ratePercent === null || kpis === undefined
              ? "—"
              : `${String(kpis.onTime.ratePercent)}%`
          }
          subline={
            kpis
              ? kpis.onTime.shipped > 0
                ? `${String(kpis.onTime.onTime)} of ${String(kpis.onTime.shipped)} shipments on time`
                : "No measurable shipments in this period"
              : undefined
          }
          icon={Truck}
          accent="delivery"
          href="/deliveries"
        />
      </section>

      {/* The rate above covers only shipments SAP gave a planned date for.
          Saying so is the difference between a KPI and a claim. */}
      {kpis && kpis.onTime.unmeasured > 0 ? (
        <p className="text-[11.5px] text-text-dim">
          {kpis.onTime.unmeasured} shipment{kpis.onTime.unmeasured === 1 ? "" : "s"} in this period
          had no planned goods-issue date in SAP, so{" "}
          {kpis.onTime.unmeasured === 1 ? "it is" : "they are"} not counted in the on-time figure.
        </p>
      ) : null}

      <OrdersByMonthChart buckets={report?.data.ordersByMonth ?? []} error={loadError} />

      <div className="grid gap-4 xl:grid-cols-2">
        <TopProductsChart rows={report?.data.topProducts ?? []} error={loadError} />
        <AovTrendChart buckets={report?.data.aov ?? []} error={loadError} />
      </div>
    </>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
