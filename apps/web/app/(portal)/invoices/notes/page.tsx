import { listCreditDebitNotes } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
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

import { getSession } from "@/lib/session";

/**
 * Credit / Debit Notes (docs/03 Screen 6.2, docs/05 §7.6: "list (FKART
 * G2/L2 badge, reason MGAGR, amount, original-invoice link)").
 *
 * A separate screen rather than a filter on the invoice list, because a
 * credit note is not a bill: it is money owed *to* the customer, and putting
 * it in the same table as invoices invites both a misread total and a
 * misread row (ADR-020).
 */

export const dynamic = "force-dynamic";

export default async function CreditDebitNotesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Credit & debit notes" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await listCreditDebitNotes(sap, session.kunnr);

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <nav aria-label="Breadcrumb" className="text-[11.5px] text-text-dim">
        <Link href="/invoices" className="hover:text-primary">
          Invoices
        </Link>
        <span aria-hidden> / </span>
        <span className="text-text-mid">Credit &amp; debit notes</span>
      </nav>

      <PageHeader
        title="Credit & debit notes"
        subtitle="Adjustments raised against your invoices."
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
      />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Document
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Type
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Date
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Reason
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Original invoice
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Amount
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
                  No credit or debit notes on this account.
                </td>
              </tr>
            ) : (
              result.invoices.map((note) => {
                const isCredit = note.billingType === "G2";
                return (
                  <tr key={note.vbeln} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <DocumentNumber value={note.vbeln} href={`/invoices/${note.vbeln}`} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-pill border px-2 py-0.5 text-[11px] font-medium ${
                          isCredit
                            ? "border-success-border bg-success-subtle text-success"
                            : "border-warning-border bg-warning-subtle text-warning"
                        }`}
                      >
                        {isCredit ? "Credit note" : "Debit note"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">
                      {formatDisplayDate(note.billingDate)}
                    </td>
                    <td className="px-4 py-2.5 text-text-mid">{note.reasonCode ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {note.reference ? (
                        <DocumentNumber
                          value={note.reference}
                          href={`/invoices/${note.reference}`}
                        />
                      ) : (
                        <span className="text-text-dim">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/* A credit is signed money: showing it in the ledger's
                          own colours stops it reading as another bill. */}
                      <Money
                        value={note.grossAmount}
                        tone={isCredit ? "credit" : "debit"}
                        className="font-semibold"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={note.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-text-dim">
        A credit note reduces what you owe — it shows on your statement as a credit and is set
        against your balance.
      </p>
    </>
  );
}
