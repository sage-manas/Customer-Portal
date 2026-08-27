import { hasPermission, STATEMENT_DOC_TYPES } from "@cc/domain";
import { getStatement, listPendingSync } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  AmountAging,
  Button,
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
import { redirect } from "next/navigation";

import { StatementFilters } from "./StatementFilters";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Account Statement (docs/03 Screen 7.1, docs/05 §7.7: "date-range +
 * doc-type filters (RV/DZ/G2), running table Debit/Credit/Balance, clearing
 * status per row (Open/Cleared with AUGBL link), closing balance card,
 * `AmountAging` bar").
 *
 * Nothing is stored: this is BSID/BSAD as SAP holds it right now. The one
 * portal-owned thing on the screen is the `Pending sync` banner — payments
 * captured by the gateway whose FI posting hasn't confirmed yet, which by
 * definition do not appear in SAP (ADR-019).
 */

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const from = single(params.from);
  const to = single(params.to);
  const requestedTypes = single(params.docType);
  const docTypes = requestedTypes ? [requestedTypes] : undefined;

  const canPay = hasPermission(session, "payment:pay");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Payments" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there is no statement to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const kunnr = session.kunnr;
  const pending = await listPendingSync(session.tenantId, kunnr);
  const statementRead = await safeRead(() =>
    getStatement(sap, kunnr, { from, to, docTypes }, { pendingCount: pending.length }),
  );

  if (!statementRead.ok) {
    return (
      <>
        <PageHeader title="Payments" subtitle={`Account statement for ${kunnr}.`} />
        <SapUnavailable reason={statementRead.reason} />
      </>
    );
  }

  const result = statementRead.data;
  const { statement, aging } = result;

  return (
    <>
      {result.freshness === "stale" ? <StaleDataBanner syncedAt={result.syncedAt} /> : null}

      <PageHeader
        title="Payments"
        subtitle={`Account statement for ${session.kunnr}.`}
        meta={<SapSyncIndicator state={result.freshness} syncedAt={result.syncedAt} />}
        actions={
          canPay && aging.totalOutstanding > 0 ? (
            <Button asChild>
              <Link href="/payments/pay">Make a payment</Link>
            </Button>
          ) : null
        }
      />

      {/* Doc 05 §7.7: a captured payment shows as `Pending sync` until the
          F-28 posting confirms. It is genuinely not in SAP yet, so saying so
          is the only honest option — silence would look like a lost payment. */}
      {pending.length > 0 ? (
        <section
          role="status"
          className="rounded-md border border-warning-border bg-warning-subtle p-4 shadow-sm"
        >
          <h2 className="text-[13px] font-bold text-warning">
            {pending.length === 1 ? "A payment is" : `${pending.length} payments are`} still being
            recorded
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-warning">
            We&apos;ve received your payment and it is being posted against your invoices. Nothing
            further is needed from you — the statement below will update once it clears.
          </p>
          <ul className="mt-2 space-y-1">
            {pending.map((payment) => (
              <li key={payment.id} className="text-[12px] text-warning">
                <Link
                  href={`/payments/${payment.id}/receipt`}
                  className="font-semibold underline underline-offset-2"
                >
                  <Money
                    value={payment.amount}
                    className="text-[12px] font-semibold text-warning"
                  />
                </Link>{" "}
                · started {formatDisplayDate(payment.createdAt.toISOString())}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <AmountAging aging={aging} />
        </div>
        <div className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Closing balance
          </p>
          <Money value={statement.closingBalance} className="mt-1 text-[20px] font-bold" />
          <dl className="mt-3 space-y-1 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-text-dim">Opening</dt>
              <dd>
                <Money value={statement.openingBalance} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Debits</dt>
              <dd>
                <Money value={statement.totalDebits} tone="debit" />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-dim">Credits</dt>
              <dd>
                <Money value={statement.totalCredits} tone="credit" />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <StatementFilters from={from} to={to} docType={requestedTypes} />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Account statement</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Date
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Document
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Type
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Debit
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Credit
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Balance
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Clearing
              </th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
                  No postings in this range.
                </td>
              </tr>
            ) : (
              statement.lines.map((line) => (
                <tr key={line.documentNumber} className="border-t border-border">
                  <td className="px-4 py-2.5 text-text-mid">
                    {formatDisplayDate(line.postingDate)}
                  </td>
                  <td className="px-4 py-2.5">
                    {line.documentType === "RV" || line.documentType === "G2" ? (
                      <DocumentNumber
                        value={line.documentNumber}
                        href={`/invoices/${line.documentNumber}`}
                      />
                    ) : (
                      <span className="font-mono text-[12px] text-text-mid">
                        {line.documentNumber}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-mid">
                    {STATEMENT_DOC_TYPES.find((t) => t.code === line.documentType)?.label ??
                      line.documentType}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {line.debit > 0 ? <Money value={line.debit} tone="debit" /> : <Dash />}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {line.credit > 0 ? <Money value={line.credit} tone="credit" /> : <Dash />}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money value={line.balance} className="font-semibold" />
                  </td>
                  <td className="px-4 py-2.5">
                    {line.clearingDocument ? (
                      <span className="inline-flex items-center gap-1.5">
                        <StatusBadge status="Cleared" />
                        <span className="font-mono text-[11px] text-text-dim">
                          {line.clearingDocument}
                        </span>
                      </span>
                    ) : (
                      <StatusBadge status={line.status} />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-text-dim">
        Balances come straight from SAP&apos;s accounts-receivable ledger. A debit increases what
        you owe; a credit reduces it.
      </p>
    </>
  );
}

function Dash() {
  return <span className="text-text-dim">—</span>;
}
