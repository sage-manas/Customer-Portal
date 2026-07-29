import { hasPermission } from "@cc/domain";
import { countDrafts, listInquiries, type InquiryFilter } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InquiryFilterChips } from "./InquiryFilterChips";

import { getSession } from "@/lib/session";

/**
 * Inquiry list (docs/03 Screen 3.1, docs/05 §7.3).
 *
 * Rendered on the server from SAP reads, with their freshness on the header —
 * nothing about an inquiry is stored (ADR-016). "Quotation received" is not a
 * flag the portal keeps either: it is the presence of VBFA's quotation on the
 * document, which is why the row links straight to it.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly InquiryFilter[] = ["all", "awaiting", "quoted"];

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "all";

  const canCreate = hasPermission(session, "inquiry:create");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Inquiries" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no inquiries to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const context = { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId };

  const [result, drafts] = await Promise.all([
    listInquiries(sap, context, { filter }),
    countDrafts(session.tenantId, session.kunnr),
  ]);

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Inquiries"
        subtitle={`Price requests raised for account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
        actions={
          canCreate ? (
            <Link
              href="/inquiries/new"
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors duration-micro hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Raise an inquiry
            </Link>
          ) : null
        }
      />

      <InquiryFilterChips active={filter} />

      {drafts > 0 && canCreate ? (
        <p className="rounded-md border border-border bg-surface px-4 py-2.5 text-[12.5px] text-text-mid">
          {drafts === 1
            ? "One saved draft on this account hasn't been sent yet."
            : `${drafts} saved drafts on this account haven't been sent yet.`}{" "}
          <Link
            href="/inquiries/new"
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Pick one up
          </Link>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Inquiry
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Raised
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Required by
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Items
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Quotation
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.inquiries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all"
                      ? "No inquiries yet. Ask us to price something and we'll come back with a quotation."
                      : "No inquiries match this filter right now."}
                  </p>
                  {/* Doc 05 §6.3: an empty state carries its next step. */}
                  {canCreate ? (
                    <Link
                      href="/inquiries/new"
                      className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Raise an inquiry
                    </Link>
                  ) : null}
                </td>
              </tr>
            ) : (
              result.inquiries.map((inquiry) => (
                <tr key={inquiry.vbeln} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber value={inquiry.vbeln} href={`/inquiries/${inquiry.vbeln}`} />
                  </td>
                  <td className="px-4 py-2.5 align-top tabular-nums text-text-mid">
                    {formatDisplayDate(inquiry.createdOn)}
                  </td>
                  <td className="px-4 py-2.5 align-top tabular-nums text-text-mid">
                    {formatDisplayDate(inquiry.requiredDeliveryDate)}
                  </td>
                  <td className="px-4 py-2.5 align-top tabular-nums text-text-mid">
                    {inquiry.lines.length}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    {inquiry.quotation ? (
                      <DocumentNumber
                        value={inquiry.quotation}
                        href={`/quotations/${inquiry.quotation}`}
                      />
                    ) : (
                      <span className="text-[11.5px] text-text-dim">With our sales team</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <StatusBadge status={inquiry.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
