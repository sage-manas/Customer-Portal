import { hasPermission, placeOfSupplyLabel } from "@cc/domain";
import { getQuotation, isInquiryError } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  Money,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  StatusBadge,
  ValidityChip,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { QuotationActions } from "./QuotationActions";

import { getSession } from "@/lib/session";

/**
 * View Quotation (docs/03 Screen 3.2, docs/05 §7.3): document header with the
 * countdown chip, the line table, the totals card, and the two actions.
 *
 * SAP owns the document, so it is read on every request and carries its
 * freshness (ADR-016). The tax breakdown is SAP's own KONV conditions read
 * back — the portal never computes GST (docs/02 §5) — and whether the
 * quotation may still be accepted is derived here and enforced again by the
 * API, which re-reads the document rather than trusting this page.
 */

export const dynamic = "force-dynamic";

export default async function QuotationPage({ params }: { params: Promise<{ vbeln: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;
  const sap = await getSapAdapterForTenant(session.tenantId);
  const context = { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId };

  const detail = await getQuotation(sap, context, vbeln).catch((error: unknown) => {
    if (isInquiryError(error) && error.code === "not_found") notFound();
    throw error;
  });

  const { quotation, validity, tax, acceptBlock, revisable, inquiry } = detail;

  // Only fetched when there is something to accept — the addresses are a
  // second SAP read and an expired quotation has no use for them.
  const shipTos =
    acceptBlock === null && session.kunnr
      ? await sap
          .getShipToAddresses(session.kunnr)
          .then((read) => read.data)
          .catch(() => [])
      : [];

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/quotations" className="hover:text-primary">
          Quotations
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">{quotation.vbeln}</span>
      </nav>

      <PageHeader
        title={`Quotation ${quotation.vbeln}`}
        subtitle={`Issued ${formatDisplayDate(quotation.createdOn)} · valid until ${formatDisplayDate(quotation.validUntil)}`}
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
        actions={
          <div className="flex items-center gap-2">
            <ValidityChip validity={validity} />
            <StatusBadge status={quotation.status} />
          </div>
        }
      />

      {quotation.salesOrder ? (
        <p className="rounded-md border border-success-border bg-success-subtle px-4 py-2.5 text-[12.5px] text-text-mid">
          You accepted this quotation — it became order{" "}
          <Link
            href={`/orders/${quotation.salesOrder}`}
            className="font-semibold text-success underline-offset-2 hover:underline"
          >
            {quotation.salesOrder}
          </Link>
          .
        </p>
      ) : acceptBlock === "expired" ? (
        <p className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger">
          This quotation expired on {formatDisplayDate(quotation.validUntil)}, so it can no longer
          be accepted. Ask for it to be revalidated and we&apos;ll send a fresh price.
        </p>
      ) : null}

      <section className="rounded-md border border-border bg-surface shadow-sm">
        <h2 className="border-b border-border px-4 py-2.5 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
          Items
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                <th scope="col" className="px-4 py-2 font-bold">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Material
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Quantity
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Unit price
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody>
              {quotation.lines.map((line) => (
                <tr key={line.lineNo} className="border-t border-border">
                  <td className="px-4 py-2.5 tabular-nums text-text-dim">{line.lineNo}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-[10.5px] text-text-dim">{line.material}</p>
                    <p className="text-text-mid">{line.description ?? line.material}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                    {line.quantity} {line.uom}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={line.netPrice} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={line.netValue} className="font-semibold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Totals card (docs/05 §7.3): net + GST breakup + gross, all SAP's. */}
      <section className="rounded-md border border-border bg-surface p-4 shadow-sm md:max-w-md md:ml-auto">
        <h2 className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
          Totals
        </h2>
        <dl className="text-[12.5px]">
          <TotalRow label="Net value" value={quotation.netValue} />
          {tax.igst > 0 ? (
            <TotalRow label="IGST" value={tax.igst} />
          ) : (
            <>
              <TotalRow label="CGST" value={tax.cgst} />
              <TotalRow label="SGST" value={tax.sgst} />
            </>
          )}
          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <dt className="font-semibold text-text">Total</dt>
            <dd className="font-semibold text-text">
              <Money value={quotation.grossValue} />
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-text-dim">
          {placeOfSupplyLabel(tax)} · as calculated by SAP
          {quotation.taxCode ? ` (tax code ${quotation.taxCode})` : ""}
        </p>
      </section>

      {inquiry ? (
        <p className="text-[12px] text-text-dim">
          Answers inquiry{" "}
          <DocumentNumber value={inquiry.vbeln} href={`/inquiries/${inquiry.vbeln}`} /> raised{" "}
          {formatDisplayDate(inquiry.createdOn)}.
        </p>
      ) : null}

      {quotation.revisionRequests && quotation.revisionRequests.length > 0 ? (
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            What you&apos;ve asked for
          </h2>
          <ul className="flex flex-col gap-2">
            {quotation.revisionRequests.map((request, index) => (
              <li key={`${request.requestedOn}-${index}`} className="text-[12.5px] text-text-mid">
                <span className="mr-2 tabular-nums text-text-dim">
                  {formatDisplayDate(request.requestedOn)}
                </span>
                {request.comment}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <QuotationActions
        vbeln={quotation.vbeln}
        shipTos={shipTos}
        acceptBlock={acceptBlock}
        revisable={revisable}
        canAccept={hasPermission(session, "quotation:accept")}
        canRequestRevision={hasPermission(session, "inquiry:create")}
        defaultRequestedDate={inquiry?.requiredDeliveryDate}
      />
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="text-text-dim">{label}</dt>
      <dd className="text-text-mid">
        <Money value={value} />
      </dd>
    </div>
  );
}
