import { hasPermission } from "@cc/domain";
import { listInvoices, type InvoiceStatusFilter } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  AmountAging,
  Button,
  DocumentNumber,
  Money,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  StatusBadge,
  formatDisplayDate,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InvoiceFilterChips } from "./InvoiceFilterChips";

import { getSession } from "@/lib/session";

/**
 * Invoice list (docs/05 §7.6: "filters (date FY-aware, status
 * Open/Overdue/Paid), aging chip per row").
 *
 * Rendered on the server from SAP reads, with their freshness on the header.
 * Nothing is stored — a billing document is a statutory record, and a
 * mirrored copy that drifted from VBRK would be worse here than anywhere
 * else in the portal (ADR-016 applied to billing).
 *
 * Credit and debit notes are not in this table. They live on their own tab,
 * because a credit sitting in a list of bills reads as money owed when it is
 * the opposite (ADR-020).
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly InvoiceStatusFilter[] = ["all", "open", "overdue", "paid"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "all";

  const canPay = hasPermission(session, "payment:pay");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Invoices" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no invoices to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await listInvoices(sap, session.kunnr, { filter });

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Invoices"
        subtitle={`Billing documents for account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
        actions={
          canPay && (result.aging?.totalOutstanding ?? 0) > 0 ? (
            <Button asChild>
              <Link href="/payments/pay">Pay now</Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <InvoiceFilterChips active={filter} />
        <Link
          href="/invoices/notes"
          className="text-[12px] font-medium text-primary underline-offset-2 hover:underline"
        >
          Credit &amp; debit notes
        </Link>
      </div>

      {/* The account position, before the documents: a customer opening this
          screen is usually asking "what do we owe?" before "which invoice?" */}
      {result.aging ? (
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <AmountAging aging={result.aging} />
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Invoice
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Date
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Reference
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Taxable
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Total (incl. GST)
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Due
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all"
                      ? "No invoices yet."
                      : "No invoices match this filter right now."}
                  </p>
                  {/* Doc 05 §6.3: an empty state carries its next step. */}
                  <Link
                    href="/orders"
                    className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    See your orders
                  </Link>
                </td>
              </tr>
            ) : (
              result.invoices.map((invoice) => (
                <tr key={invoice.vbeln} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <DocumentNumber value={invoice.vbeln} href={`/invoices/${invoice.vbeln}`} />
                  </td>
                  <td className="px-4 py-2.5 text-text-mid">
                    {formatDisplayDate(invoice.billingDate)}
                  </td>
                  <td className="px-4 py-2.5">
                    {invoice.reference ? (
                      <DocumentNumber
                        value={invoice.reference}
                        href={`/orders/${invoice.reference}`}
                      />
                    ) : (
                      <span className="text-text-dim">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={invoice.taxableAmount} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={invoice.grossAmount} className="font-semibold" />
                  </td>
                  <td className="px-4 py-2.5">
                    <DueChip
                      dueDate={invoice.dueDate}
                      dueInDays={invoice.dueInDays}
                      daysOverdue={invoice.daysOverdue}
                      settled={invoice.status === "Paid" || invoice.status === "Cleared"}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-text-dim">
        GST is calculated by SAP on the invoice. Amounts here are exactly as billed.
      </p>
    </>
  );
}

/**
 * Days-left / overdue chip (docs/05 §7.6). A settled invoice shows its date
 * plainly — counting days on something already paid is noise.
 */
function DueChip({
  dueDate,
  dueInDays,
  daysOverdue,
  settled,
}: {
  dueDate: string;
  dueInDays: number;
  daysOverdue: number;
  settled: boolean;
}) {
  if (settled) {
    return <span className="text-text-mid">{formatDisplayDate(dueDate)}</span>;
  }

  if (daysOverdue > 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-text-mid">{formatDisplayDate(dueDate)}</span>
        <span className="rounded-pill border border-danger-border bg-danger-subtle px-1.5 py-0.5 text-[11px] font-semibold text-danger">
          {daysOverdue}d overdue
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-text-mid">{formatDisplayDate(dueDate)}</span>
      <span className="text-[11px] text-text-dim">
        {dueInDays === 0 ? "due today" : `in ${dueInDays}d`}
      </span>
    </span>
  );
}
