import { hasPermission, placeOfSupplyLabel } from "@cc/domain";
import { getInvoice, isInvoiceError } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  ComplianceBadge,
  DocumentNumber,
  Money,
  O2CTimeline,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { InvoiceActions } from "./InvoiceActions";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Invoice detail (docs/03 Screen 6.1, docs/05 §7.6): "document header
 * (VBELN, FKDAT, linked SO/delivery links), line table, **tax card**:
 * taxable NETWR + CGST/SGST _or_ IGST split (place-of-supply logic
 * surfaced), gross total; **ComplianceBadge IRN**; due date with
 * days-left/overdue chip."
 *
 * The tax card *displays* what SAP calculated — the portal never computes
 * GST (docs/02 §5). Which conditions were applied is what tells the customer
 * whether the supply was intra- or inter-state, and that reading is done in
 * @cc/domain so this page and the PDF cannot disagree.
 */

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ vbeln: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { vbeln } = await params;

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() =>
    getInvoice(sap, session.kunnr, vbeln).catch((error: unknown) => {
      // Another customer's invoice and one that never existed give the same
      // answer, deliberately (CLAUDE.md rule 5).
      if (isInvoiceError(error) && error.code === "not_found") notFound();
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title={`Invoice ${vbeln}`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const detail = result.data;
  const { invoice, tax } = detail;
  const isNote = invoice.billingType === "G2" || invoice.billingType === "L2";
  const noun = isNote ? (invoice.billingType === "G2" ? "Credit note" : "Debit note") : "Invoice";

  return (
    <>
      {detail.freshness === "stale" ? <StaleDataBanner syncedAt={detail.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/invoices" className="hover:text-primary">
          Invoices
        </Link>
        <span aria-hidden> / </span>
        <span className="font-mono text-text-mid">{invoice.vbeln}</span>
      </nav>

      <PageHeader
        title={`${noun} ${invoice.vbeln}`}
        subtitle={`Billed ${formatDisplayDate(invoice.billingDate)}${
          invoice.reference ? ` against ${invoice.reference}` : ""
        }`}
        meta={<SapSyncIndicator state={detail.freshness} syncedAt={detail.syncedAt} />}
        actions={
          <InvoiceActions
            vbeln={invoice.vbeln}
            payable={detail.payable}
            canPay={hasPermission(session, "payment:pay")}
            canRaiseTicket={hasPermission(session, "support:create")}
          />
        }
      />

      {/* The chain, first — doc 05 P4: status is a spine. */}
      {detail.timeline.length > 0 ? (
        <O2CTimeline stages={detail.timeline} currentStage="invoice" />
      ) : null}

      {detail.daysOverdue > 0 && detail.payable ? (
        <section
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle p-4 shadow-sm"
        >
          <h2 className="text-[13.5px] font-bold text-danger">
            Overdue by {detail.daysOverdue} days
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-danger">
            This invoice was due on {formatDisplayDate(invoice.dueDate)}. Settling it also helps
            release any orders sitting on credit hold.
          </p>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* --- Tax card (docs/05 §7.6) --- */}
        <div className="rounded-md border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-bold text-text">Tax</h2>
            <span className="rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-text-mid">
              {placeOfSupplyLabel(tax)}
            </span>
          </div>

          <dl className="mt-3 space-y-1.5 text-[12.5px]">
            <TaxRow label="Taxable value (ex-GST)" value={tax.taxableAmount} />
            {tax.placeOfSupply === "inter-state" ? (
              <TaxRow label="IGST" value={tax.igst} />
            ) : (
              <>
                <TaxRow label="CGST" value={tax.cgst} />
                <TaxRow label="SGST" value={tax.sgst} />
              </>
            )}
            <div className="flex items-baseline justify-between border-t border-border-strong pt-2">
              <dt className="text-[13px] font-bold text-text">Total payable</dt>
              <dd>
                <Money value={tax.grossAmount} className="text-[15px] font-bold" />
              </dd>
            </div>
          </dl>

          <p className="mt-2 text-[11px] text-text-dim">
            Calculated by SAP on the billing document. The portal displays it as billed.
          </p>
        </div>

        {/* --- Status + compliance --- */}
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">Status</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={invoice.status} />
              <span className="text-[11.5px] text-text-dim">
                Due {formatDisplayDate(invoice.dueDate)}
              </span>
            </div>
            {detail.openItem ? (
              <p className="mt-2 text-[12px] text-text-mid">
                Outstanding: <Money value={detail.openItem.openAmount} className="font-semibold" />
                {detail.openItem.clearingDocument ? (
                  <span className="ml-1 text-text-dim">
                    · cleared by {detail.openItem.clearingDocument}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          {/* Doc 05 P5: compliance identifiers are trust signals, and Indian
              B2B buyers actively check the IRN. */}
          {invoice.irn ? (
            <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                E-invoice
              </p>
              <div className="mt-2">
                <ComplianceBadge kind="irn" value={invoice.irn} state="verified" />
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                E-invoice
              </p>
              <p className="mt-2 text-[11.5px] text-text-dim">
                No IRN on this document — it may fall below the e-invoicing threshold.
              </p>
            </div>
          )}
        </div>
      </section>

      {detail.notes.length > 0 ? (
        <section className="rounded-md border border-border bg-surface shadow-sm">
          <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text">
            Notes raised against this invoice
          </h2>
          <ul className="divide-y divide-border">
            {detail.notes.map((note) => (
              <li key={note.vbeln} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <DocumentNumber value={note.vbeln} href={`/invoices/${note.vbeln}`} />
                <span className="rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-text-mid">
                  {note.billingType === "G2" ? "Credit note" : "Debit note"}
                </span>
                <span className="text-[11.5px] text-text-dim">
                  {formatDisplayDate(note.billingDate)}
                  {note.reasonCode ? ` · reason ${note.reasonCode}` : ""}
                </span>
                <Money value={note.grossAmount} className="ml-auto font-semibold" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-[11.5px] text-text-dim">
        Something wrong with this invoice? Raise a dispute and our billing team will pick it up with
        the document attached.
      </p>
    </>
  );
}

function TaxRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-text-mid">{label}</dt>
      <dd>
        <Money value={value} />
      </dd>
    </div>
  );
}
