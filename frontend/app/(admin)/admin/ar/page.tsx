import { hasPermission } from "@cc/domain";
import { listInvoiceRegister } from "@cc/service-invoice";
import { listCreditBlockedOrders } from "@cc/service-order";
import {
  getStatement,
  getTenantLedger,
  listDunningCandidates,
  listPaymentsReceived,
} from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  AmountAging,
  Badge,
  DocumentNumber,
  KpiCard,
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

import { DeskActionButton } from "../ap/DeskActionButton";
import { WorkspaceTabs, resolveTab } from "../WorkspaceTabs";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Accounts Receivable (doc 09 §1 tier 4, §3.4 — the AR workspace).
 *
 * Incoming money: the invoice register, the tenant's open items and their
 * aging, an account's statement, the payments the gateway has taken, the
 * orders SAP is holding on credit, and who is worth chasing. Guarded by
 * `finance:ar` — `ar_manager` holds it, `client_admin` holds it by
 * composition — with one exception noted below.
 *
 * Three things this screen deliberately does not do:
 *
 *  - **Store anything.** Every figure but the receipts is composed from a
 *    tenant-wide SAP read carrying its own freshness (ADR-016). The receipts
 *    come from the one table the portal owns (ADR-019) and answer "what did
 *    we take?", never "what is owed?".
 *  - **Re-bucket.** The headline aging bar and the per-account rows are both
 *    `buildAging` — the same function the customer's own statement uses, so
 *    the desk's total and the customer's balance cannot disagree.
 *  - **Force a credit release.** The Release button runs VKM3, which *re-runs
 *    the credit check*; an order still over its limit comes back held with
 *    SAP's reason, and the screen shows that rather than reporting success
 *    (ADR-059). Changing the limit itself is the credit desk's decision and
 *    still happens in FD32.
 */

export const dynamic = "force-dynamic";

const TABS = ["register", "ledger", "receipts", "credit", "dunning"] as const;
type Tab = (typeof TABS)[number];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountsReceivablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "finance:ar")) redirect("/403");

  const params = await searchParams;
  const tab: Tab = resolveTab(params.tab, TABS);
  const selectedKunnr = first(params.kunnr);

  const sap = await getSapAdapterForTenant(session.tenantId);

  const registerResult = tab === "register" ? await safeRead(() => listInvoiceRegister(sap)) : null;
  const ledgerResult = tab === "ledger" ? await safeRead(() => getTenantLedger(sap)) : null;
  const receipts = tab === "receipts" ? await listPaymentsReceived(session.tenantId) : null;
  const blockedResult = tab === "credit" ? await safeRead(() => listCreditBlockedOrders(sap)) : null;
  const dunningResult = tab === "dunning" ? await safeRead(() => listDunningCandidates(sap)) : null;

  const failedResult = [registerResult, ledgerResult, blockedResult, dunningResult].find(
    (r) => r && !r.ok,
  );
  if (failedResult && !failedResult.ok) {
    return (
      <>
        <PageHeader
          title="Accounts Receivable"
          subtitle="Money coming in: what has been billed, what is outstanding, what has been received, and who is worth chasing."
        />
        <SapUnavailable reason={failedResult.reason} />
      </>
    );
  }

  const register = registerResult?.ok ? registerResult.data : null;
  const ledger = ledgerResult?.ok ? ledgerResult.data : null;
  const blocked = blockedResult?.ok ? blockedResult.data : null;
  const dunning = dunningResult?.ok ? dunningResult.data : null;

  /**
   * The statement is a drill-down of the ledger rather than a tab: it needs
   * an account, and a tab that is blank until you pick one is a worse
   * affordance than a row you click. The account comes from a KUNNR the
   * tenant's own ledger just returned, so this is a tenant-bounded read
   * reached through the desk's permission — not the customer-plane entry
   * point with somebody else's account passed in.
   */
  const statement =
    tab === "ledger" && selectedKunnr
      ? await getStatement(sap, selectedKunnr).catch(() => null)
      : null;

  const read = register ?? ledger ?? blocked ?? dunning;

  return (
    <>
      {read?.freshness === "stale" ? <StaleDataBanner syncedAt={read.syncedAt} /> : null}

      <PageHeader
        title="Accounts Receivable"
        subtitle="Money coming in: what has been billed, what is outstanding, what has been received, and who is worth chasing."
        meta={
          read ? <SapSyncIndicator state={read.freshness} syncedAt={read.syncedAt} /> : undefined
        }
      />

      <WorkspaceTabs
        basePath="/admin/ar"
        active={tab}
        tabs={[
          { key: "register", label: "Invoice register" },
          { key: "ledger", label: "Open items & aging" },
          { key: "receipts", label: "Payments received" },
          { key: "credit", label: "Credit release" },
          { key: "dunning", label: "Dunning" },
        ]}
      />

      {register ? (
        <section className="flex flex-col gap-3">
          <p className="text-[12px] text-text-mid">
            {register.total} invoice{register.total === 1 ? "" : "s"} ·{" "}
            <Money value={register.totalValue} className="text-[12px]" /> billed. Credit and debit
            notes are the AP desk&apos;s register, not this one.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Invoice
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Billed
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Due
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Gross
                  </th>
                </tr>
              </thead>
              <tbody>
                {register.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                      Nothing has been billed yet.
                    </td>
                  </tr>
                ) : (
                  register.rows.map((row) => (
                    <tr key={row.vbeln} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <DocumentNumber value={row.vbeln} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {row.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(row.billingDate)}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(row.dueDate)}
                        {row.daysOverdue > 0 ? (
                          <span className="ml-1 text-[11px] text-danger">+{row.daysOverdue} d</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={row.grossAmount} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {ledger ? (
        <section className="flex flex-col gap-4">
          <AmountAging aging={ledger.aging} />

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Outstanding
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Overdue
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Oldest
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Items
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-text-dim">
                      Nothing outstanding. Every open item has cleared.
                    </td>
                  </tr>
                ) : (
                  ledger.customers.map((row) => (
                    <tr key={row.kunnr} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/ar?tab=ledger&kunnr=${row.kunnr}`}
                          className="font-mono text-[11.5px] text-primary hover:underline"
                        >
                          {row.kunnr}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={row.aging.totalOutstanding} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money
                          value={row.aging.totalOverdue}
                          className={row.aging.totalOverdue > 0 ? "text-danger" : undefined}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                        {row.oldestOverdueDays > 0 ? `${row.oldestOverdueDays} d` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                        {row.openItemCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedKunnr ? (
            <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[13px] font-semibold text-text">
                  Statement · <span className="font-mono">{selectedKunnr}</span>
                </h2>
                <Link
                  href="/admin/ar?tab=ledger"
                  className="text-[11.5px] text-text-mid hover:underline"
                >
                  Close
                </Link>
              </div>

              {statement ? (
                <table className="mt-3 w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-text-dim">
                      <th scope="col" className="py-1.5 font-bold">
                        Document
                      </th>
                      <th scope="col" className="py-1.5 font-bold">
                        Posted
                      </th>
                      <th scope="col" className="py-1.5 text-right font-bold">
                        Debit
                      </th>
                      <th scope="col" className="py-1.5 text-right font-bold">
                        Credit
                      </th>
                      <th scope="col" className="py-1.5 text-right font-bold">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.statement.lines.map((line) => (
                      <tr key={line.documentNumber} className="border-t border-border">
                        <td className="py-1.5 font-mono text-[11px]">{line.documentNumber}</td>
                        <td className="py-1.5 text-text-mid">
                          {formatDisplayDate(line.postingDate)}
                        </td>
                        <td className="py-1.5 text-right">
                          {line.debit ? <Money value={line.debit} /> : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          {line.credit ? <Money value={line.credit} /> : "—"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          <Money value={line.balance} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-3 text-[12px] text-text-dim">
                  We couldn&apos;t read that account&apos;s statement from SAP just now.
                </p>
              )}
            </section>
          ) : null}
        </section>
      ) : null}

      {receipts ? (
        <section className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard label="Received" value={<Money value={receipts.totalReceived} />} />
            <KpiCard
              label="Awaiting SAP posting"
              value={String(receipts.pendingSyncCount)}
              subline="Captured by the gateway, not yet cleared in FI — reconciliation sweeps these, and the AP tray is where the stuck ones surface."
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Taken
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Mode
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    State
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    FI document
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {receipts.payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                      No payments have been taken through the portal yet.
                    </td>
                  </tr>
                ) : (
                  receipts.payments.map((payment) => (
                    <tr key={payment.id} className="border-t border-border">
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {payment.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(payment.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">{payment.mode}</td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            payment.status === "posted"
                              ? "success"
                              : payment.status === "captured"
                                ? "warning"
                                : payment.status === "failed"
                                  ? "danger"
                                  : "neutral"
                          }
                        >
                          {payment.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {payment.fiDocumentNumber ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={payment.amount} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {blocked ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-md border border-border bg-background px-4 py-2.5 text-[11.5px] text-text-mid">
            SAP is holding {blocked.rows.length} order{blocked.rows.length === 1 ? "" : "s"} worth{" "}
            <Money value={blocked.blockedValue} className="text-[11.5px]" /> on credit. Release runs
            VKM3, which <strong className="font-semibold">re-runs the credit check</strong> — an
            order still over its account&apos;s limit stays held, and you&apos;ll see SAP&apos;s
            reason. Days shown are the order&apos;s age; SAP does not date the block itself.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Raised
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    PO reference
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Net value
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {blocked.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                      Nothing is held on credit.
                    </td>
                  </tr>
                ) : (
                  blocked.rows.map((row) => (
                    <tr key={row.order.vbeln} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <DocumentNumber value={row.order.vbeln} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {row.order.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(row.order.createdOn)}
                        <span className="ml-1 text-[11px] text-text-dim">
                          ({row.blockedDays} d)
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {row.order.customerPoRef ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={row.order.netValue} />
                      </td>
                      <td className="px-4 py-2.5">
                        <DeskActionButton
                          endpoint={`/api/admin/ar/credit-blocks/${row.order.vbeln}/release`}
                          label="Release"
                          busyLabel="Releasing…"
                          title={`Release order ${row.order.vbeln}?`}
                          consequence={`This runs VKM3 in SAP, which re-runs the credit check on ${row.order.currency} ${row.order.netValue.toLocaleString("en-IN")} for ${row.order.kunnr}. If it passes, the order is released for delivery and the value consumes the account's credit exposure. If it doesn't, SAP keeps holding it and tells you why.`}
                          confirmLabel="Run the check"
                          refusal={(result) =>
                            result.released === false
                              ? ((result.reason as string) ??
                                "SAP re-ran the credit check and is still holding this order.")
                              : null
                          }
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {dunning ? (
        <section className="flex flex-col gap-3">
          <p className="text-[12px] text-text-mid">
            <Money value={dunning.totalOverdue} className="text-[12px]" /> overdue across{" "}
            {dunning.candidates.length} account{dunning.candidates.length === 1 ? "" : "s"}. The
            level comes from the oldest overdue item, not the largest.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Level
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    What to do
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Overdue
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Oldest
                  </th>
                </tr>
              </thead>
              <tbody>
                {dunning.candidates.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-text-dim">
                      Nobody is overdue. Nothing to chase.
                    </td>
                  </tr>
                ) : (
                  dunning.candidates.map((candidate) => (
                    <tr key={candidate.kunnr} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/ar?tab=ledger&kunnr=${candidate.kunnr}`}
                          className="font-mono text-[11.5px] text-primary hover:underline"
                        >
                          {candidate.kunnr}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={candidate.level.level >= 3 ? "danger" : "warning"}>
                          {candidate.level.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">{candidate.level.action}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={candidate.overdueAmount} className="font-semibold" />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                        {candidate.oldestOverdueDays} d
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
