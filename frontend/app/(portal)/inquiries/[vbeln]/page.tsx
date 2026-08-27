import { getInquiry, isInquiryError } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  DocumentNumber,
  Money,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * One inquiry (docs/03 Screen 3.1, docs/05 §7.3).
 *
 * Read straight from SAP on every request and carrying its freshness — the
 * portal stores nothing about it (ADR-016). An inquiry belonging to another
 * sold-to account is a **404**, exactly as one that never existed is: the
 * service compares VBAK-KUNNR to the session's before anything renders.
 */

export const dynamic = "force-dynamic";

export default async function InquiryPage({ params }: { params: Promise<{ vbeln: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;
  const sap = await getSapAdapterForTenant(session.tenantId);

  const result = await safeRead(() =>
    getInquiry(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      vbeln,
    ).catch((error: unknown) => {
      if (isInquiryError(error) && error.code === "not_found") notFound();
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title={`Inquiry ${vbeln}`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const detail = result.data;
  const { inquiry, quotation } = detail;

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/inquiries" className="hover:text-primary">
          Inquiries
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">{inquiry.vbeln}</span>
      </nav>

      <PageHeader
        title={`Inquiry ${inquiry.vbeln}`}
        subtitle={`Raised ${formatDisplayDate(inquiry.createdOn)} · required by ${formatDisplayDate(inquiry.requiredDeliveryDate)}`}
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
        actions={<StatusBadge status={inquiry.status} />}
      />

      {/* The one thing the customer is waiting for. */}
      {quotation ? (
        <p className="rounded-md border border-success-border bg-success-subtle px-4 py-2.5 text-[12.5px] text-text-mid">
          Your quotation is ready —{" "}
          <Link
            href={`/quotations/${quotation.vbeln}`}
            className="font-semibold text-success underline-offset-2 hover:underline"
          >
            {quotation.vbeln}
          </Link>
          , valid until {formatDisplayDate(quotation.validUntil)}. Total{" "}
          <Money value={quotation.grossValue} /> including tax.
        </p>
      ) : (
        <p className="rounded-md border border-border bg-surface px-4 py-2.5 text-[12.5px] text-text-mid">
          With our sales team. We&apos;ll come back with a quotation you can accept — you&apos;ll
          see it here and on your quotations list.
        </p>
      )}

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
                  Quoted price
                </th>
              </tr>
            </thead>
            <tbody>
              {inquiry.lines.map((line) => {
                const quoted = quotation?.lines.find((l) => l.lineNo === line.lineNo);
                return (
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
                      {quoted ? (
                        <Money value={quoted.netPrice} className="font-semibold" />
                      ) : (
                        <span className="text-[11px] text-text-dim">Awaiting price</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {inquiry.notes ? (
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            What you told us
          </h2>
          <p className="whitespace-pre-wrap text-[12.5px] text-text-mid">{inquiry.notes}</p>
        </section>
      ) : null}

      {quotation ? (
        <p className="text-[12px] text-text-dim">
          Quotation{" "}
          <DocumentNumber value={quotation.vbeln} href={`/quotations/${quotation.vbeln}`} /> answers
          this inquiry.
        </p>
      ) : null}
    </>
  );
}
