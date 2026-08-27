import { listQuotations, type QuotationFilter } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  Money,
  PageHeader,
  Pager,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  ValidityChip,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { QuotationFilterChips } from "./QuotationFilterChips";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Quotation list (docs/03 Screen 3.2, docs/05 §7.3).
 *
 * Sorted by what lapses soonest, because a quotation is a deadline: the one
 * about to expire is the one the customer has to decide about. Ones already
 * turned into orders have no deadline left and sink to the bottom.
 *
 * Nothing here is stored (ADR-016) — including the expiry state, which is
 * derived from VBAK-BNDDT against the clock on every read.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly QuotationFilter[] = ["all", "open", "expiring", "expired", "converted"];
const PAGE_SIZE = 10;

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "all";
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const offset = Math.max(0, Number(pageParam ?? 1) - 1) * PAGE_SIZE;

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Quotations" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no quotations to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const read = await safeRead(() =>
    listQuotations(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      { filter, limit: PAGE_SIZE, offset },
    ),
  );

  if (!read.ok) {
    return (
      <>
        <PageHeader
          title="Quotations"
          subtitle={`Prices we've offered account ${session.kunnr}.`}
        />
        <SapUnavailable reason={read.reason} />
      </>
    );
  }

  const result = read.data;

  const expiring = result.expiringCount;

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Quotations"
        subtitle={`Prices we've offered account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
      />

      <QuotationFilterChips active={filter} />

      {expiring > 0 && filter !== "expiring" ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-2.5 text-[12.5px] text-text-mid">
          {expiring === 1
            ? "One quotation expires within three days."
            : `${expiring} quotations expire within three days.`}{" "}
          <Link
            href="/quotations?filter=expiring"
            className="font-semibold underline-offset-2 hover:underline"
          >
            Show them
          </Link>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Quotation
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Issued
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Valid until
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Total (incl. tax)
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Outcome
              </th>
            </tr>
          </thead>
          <tbody>
            {result.quotations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all"
                      ? "No quotations yet. Raise an inquiry and we'll price it."
                      : "No quotations match this filter right now."}
                  </p>
                  <Link
                    href="/inquiries/new"
                    className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Raise an inquiry
                  </Link>
                </td>
              </tr>
            ) : (
              result.quotations.map((view) => (
                <tr key={view.quotation.vbeln} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber
                      value={view.quotation.vbeln}
                      href={`/quotations/${view.quotation.vbeln}`}
                    />
                  </td>
                  <td className="px-4 py-2.5 align-top tabular-nums text-text-mid">
                    {formatDisplayDate(view.quotation.createdOn)}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="mr-2 tabular-nums text-text-mid">
                      {formatDisplayDate(view.quotation.validUntil)}
                    </span>
                    <ValidityChip validity={view.validity} dense />
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    <Money value={view.quotation.grossValue} className="font-semibold" />
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    {view.quotation.salesOrder ? (
                      <DocumentNumber
                        value={view.quotation.salesOrder}
                        href={`/orders/${view.quotation.salesOrder}`}
                      />
                    ) : view.acceptBlock === null ? (
                      <Link
                        href={`/quotations/${view.quotation.vbeln}`}
                        className="text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Review &amp; accept
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-text-dim">Ask for a fresh price</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pager
        total={result.total}
        pageSize={PAGE_SIZE}
        offset={offset}
        hrefFor={(next) =>
          `/quotations?${new URLSearchParams({
            ...(filter !== "all" ? { filter } : {}),
            page: String(Math.floor(next / PAGE_SIZE) + 1),
          })}`
        }
      />
    </>
  );
}
