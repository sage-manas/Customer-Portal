import { hasPermission } from "@cc/domain";
import { getArSummary, isReportingError } from "@cc/service-reporting";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { Money, PageHeader, SapSyncIndicator, StaleDataBanner } from "@cc/ui";
import { redirect } from "next/navigation";

import { ReportTabs } from "../ReportTabs";

import { ArBucketDrilldown } from "./ArBucketDrilldown";

import { getSession } from "@/lib/session";

/**
 * AR summary (docs/05 §7.10).
 *
 * The balance comes from BSID on every read — never from the portal's own
 * payment rows. That is ADR-019's distinction, and a report is exactly where
 * it would be tempting to break: the stored payments answer "what did we
 * take?", and this screen answers "what does the customer owe?". Different
 * question, different owner.
 *
 * There is no period filter here on purpose. Doc 05 §7.10 gives the aging
 * bar a drill-down, not a date range, and ADR-018 already settled the
 * reasoning for the statement: narrowing a date range is not a request to
 * change the account position.
 */

export const dynamic = "force-dynamic";

export default async function ArSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "report:view")) redirect("/403");

  const params = await searchParams;
  const refresh = (Array.isArray(params.refresh) ? params.refresh[0] : params.refresh) === "1";

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Reports" />
        <ReportTabs />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there&apos;s no receivables position
          to show. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const adapter = await getSapAdapterForTenant(session.tenantId);

  let summary;
  let loadError: string | undefined;
  try {
    summary = await getArSummary(
      adapter,
      { tenantId: session.tenantId, kunnr: session.kunnr },
      { refresh },
    );
  } catch (error) {
    if (!isReportingError(error)) throw error;
    loadError = error.message;
  }

  return (
    <>
      {summary?.freshness === "stale" ? <StaleDataBanner syncedAt={summary.syncedAt} /> : null}

      <PageHeader
        title="Reports"
        subtitle={`Receivables position for account ${session.kunnr}.`}
        meta={
          summary ? (
            <SapSyncIndicator state={summary.freshness} syncedAt={summary.syncedAt} />
          ) : undefined
        }
      />

      <ReportTabs />

      {loadError ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-6 text-center text-[12.5px] text-danger"
        >
          {loadError}
        </p>
      ) : summary ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                Total outstanding
              </p>
              <Money value={summary.data.aging.totalOutstanding} className="text-[18px]" />
            </div>
            <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                Of which overdue
              </p>
              <Money
                value={summary.data.aging.totalOverdue}
                tone={summary.data.aging.totalOverdue > 0 ? "debit" : "neutral"}
                className="text-[18px]"
              />
            </div>
          </section>

          <ArBucketDrilldown aging={summary.data.aging} documents={summary.data.documents} />
        </>
      ) : null}
    </>
  );
}
