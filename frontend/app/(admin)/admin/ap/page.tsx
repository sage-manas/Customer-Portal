import { hasPermission } from "@cc/domain";
import { listNoteRegister, listRefundQueue } from "@cc/service-invoice";
import { listRebateSettlements } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  Badge,
  DocumentNumber,
  Money,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  formatDisplayDate,
} from "@cc/ui";
import { redirect } from "next/navigation";

import { WorkspaceTabs, resolveTab } from "../WorkspaceTabs";

import { DeskActionButton } from "./DeskActionButton";
import { ReconciliationTray } from "./ReconciliationTray";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Accounts Payable (doc 09 §1 tier 4, §3.4 — the AP workspace).
 *
 * Outgoing money: the credit and debit notes the tenant has raised, the
 * credits it still owes back, the rebates it has accrued, and the gateway
 * exceptions that need a human. Guarded by `finance:ap`, which `ap_manager`
 * holds and which `client_admin` holds by composition (doc 09 §2) — the
 * screen never asks which role is looking.
 *
 * The two actions here — pay a credit out (F-58) and settle a rebate (VB(7) —
 * **run the SAP transaction**, and the portal records nothing of its own about
 * them (ADR-059). SAP's payment document and credit memo request are the
 * record; the session's user rides onto each as the authoriser, and the queue
 * re-reads afterwards, so what the desk sees next is SAP's answer rather than
 * an optimistic row. Both are idempotent on a key derived from the document,
 * so a double-clicked button is one payout.
 *
 * What is deliberately *not* here: releasing a rebate for settlement (VBO2)
 * and approving a credit limit. The portal performs settlement runs, not the
 * decisions that authorise them.
 */

export const dynamic = "force-dynamic";

const TABS = ["notes", "refunds", "rebates", "reconciliation"] as const;
type Tab = (typeof TABS)[number];

export default async function AccountsPayablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "finance:ap")) redirect("/403");

  const tab: Tab = resolveTab(await searchParams.then((p) => p.tab), TABS);
  const sap = await getSapAdapterForTenant(session.tenantId);

  // Only the view being rendered is read: six registers on every visit would
  // make the cheapest tab pay for the most expensive one.
  let notes: Awaited<ReturnType<typeof listNoteRegister>> | null = null;
  let refunds: Awaited<ReturnType<typeof listRefundQueue>> | null = null;
  let rebates: Awaited<ReturnType<typeof listRebateSettlements>> | null = null;
  let sapUnavailableReason: string | undefined;

  if (tab === "notes") {
    const result = await safeRead(() => listNoteRegister(sap));
    if (result.ok) notes = result.data;
    else sapUnavailableReason = result.reason;
  } else if (tab === "refunds") {
    const result = await safeRead(() => listRefundQueue(sap));
    if (result.ok) refunds = result.data;
    else sapUnavailableReason = result.reason;
  } else if (tab === "rebates") {
    const result = await safeRead(() => listRebateSettlements(sap));
    if (result.ok) rebates = result.data;
    else sapUnavailableReason = result.reason;
  }

  if (sapUnavailableReason) {
    return (
      <>
        <PageHeader
          title="Accounts Payable"
          subtitle="Money going out: notes raised, credits owed back, rebates accrued, and what reconciliation couldn't settle."
        />
        <SapUnavailable reason={sapUnavailableReason} />
      </>
    );
  }

  const read = notes ?? refunds ?? rebates;

  return (
    <>
      {read?.freshness === "stale" ? <StaleDataBanner syncedAt={read.syncedAt} /> : null}

      <PageHeader
        title="Accounts Payable"
        subtitle="Money going out: notes raised, credits owed back, rebates accrued, and what reconciliation couldn't settle."
        meta={
          read ? <SapSyncIndicator state={read.freshness} syncedAt={read.syncedAt} /> : undefined
        }
      />

      <WorkspaceTabs
        basePath="/admin/ap"
        active={tab}
        tabs={[
          { key: "notes", label: "Credit & debit notes" },
          { key: "refunds", label: "Refunds owed" },
          { key: "rebates", label: "Rebate settlements" },
          { key: "reconciliation", label: "Reconciliation" },
        ]}
      />

      {notes ? (
        <section className="flex flex-col gap-3">
          <p className="text-[12px] text-text-mid">
            {notes.total} note{notes.total === 1 ? "" : "s"} ·{" "}
            <Money value={notes.totalValue} className="text-[12px]" /> adjusted. SAP owns these
            documents; the tax on each is what it calculated.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Document
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Raised
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Reason
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-text-dim">
                      No credit or debit notes have been raised.
                    </td>
                  </tr>
                ) : (
                  notes.rows.map((row) => (
                    <tr key={row.vbeln} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <DocumentNumber value={row.vbeln} />{" "}
                        <Badge variant={row.billingType === "G2" ? "success" : "warning"}>
                          {row.billingType === "G2" ? "Credit" : "Debit"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {row.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(row.billingDate)}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">{row.reasonCode ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={Math.abs(row.grossAmount)} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {refunds ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-md border border-border bg-background px-4 py-2.5 text-[11.5px] text-text-mid">
            Credit notes whose FI item is still open —{" "}
            <Money value={refunds.totalOwed} className="text-[11.5px]" /> owed back across{" "}
            {refunds.refunds.length} document
            {refunds.refunds.length === 1 ? "" : "s"}. Paying one here posts the F-58 outgoing
            payment and clears the FI item; a credit can also disappear from this list by clearing
            against the account&apos;s next invoice.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Credit note
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Raised
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Still open
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Waiting
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {refunds.refunds.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                      Nothing owed back. Every credit note has cleared.
                    </td>
                  </tr>
                ) : (
                  refunds.refunds.map((refund) => (
                    <tr key={refund.vbeln} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <DocumentNumber value={refund.vbeln} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {refund.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(refund.billingDate)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={refund.openAmount} className="font-semibold" />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                        {refund.daysOutstanding} d
                      </td>
                      <td className="px-4 py-2.5">
                        <DeskActionButton
                          endpoint={`/api/admin/ap/refunds/${refund.vbeln}/pay`}
                          label="Pay out"
                          busyLabel="Paying…"
                          tone="destructive"
                          title={`Pay ${refund.kunnr} back?`}
                          consequence={`This posts an outgoing payment (F-58) of ${refund.currency} ${refund.openAmount.toLocaleString("en-IN")} in SAP and clears credit note ${refund.vbeln}. Money leaves the tenant's bank account — it can only be reversed by an FI reversal.`}
                          confirmLabel="Pay it out"
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

      {rebates ? (
        <section className="flex flex-col gap-3">
          <p className="rounded-md border border-border bg-background px-4 py-2.5 text-[11.5px] text-text-mid">
            <Money value={rebates.releasedValue} className="text-[11.5px]" /> released for
            settlement
            {rebates.overdueCount > 0
              ? ` · ${rebates.overdueCount} agreement${rebates.overdueCount === 1 ? " has" : "s have"} lapsed unsettled`
              : null}
            . Accruals are SAP&apos;s own arithmetic (KONA-KAWRT). Settling here runs VB(7 and posts
            the credit memo request SAP then bills; releasing an agreement *for* settlement stays in
            VBO2, which is why an open agreement has no button.
          </p>

          <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Agreement
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Valid to
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Accrued
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {rebates.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-dim">
                      No rebate agreements exist for this tenant.
                    </td>
                  </tr>
                ) : (
                  rebates.rows.map((row) => (
                    <tr key={row.agreement.agreementNumber} className="border-t border-border">
                      <td className="px-4 py-2.5">
                        <DocumentNumber value={row.agreement.agreementNumber} />
                        <span className="mt-0.5 block text-[11px] text-text-dim">
                          {row.agreement.description}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-text-mid">
                        {row.agreement.kunnr}
                      </td>
                      <td className="px-4 py-2.5 text-text-mid">
                        {formatDisplayDate(row.agreement.validTo)}
                        {row.overdueForSettlement ? (
                          <span className="mt-0.5 block text-[11px] text-danger">
                            Lapsed {Math.abs(row.daysToExpiry)} days ago, not settled
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={
                            row.state.settleable
                              ? "success"
                              : row.state.code === "D"
                                ? "neutral"
                                : "info"
                          }
                        >
                          {row.state.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Money value={row.agreement.accruedAmount} />
                      </td>
                      <td className="px-4 py-2.5">
                        <DeskActionButton
                          endpoint={`/api/admin/ap/rebates/${row.agreement.agreementNumber}/settle`}
                          label="Settle"
                          busyLabel="Settling…"
                          title={`Settle agreement ${row.agreement.agreementNumber}?`}
                          consequence={`This runs the VB(7 settlement in SAP: it posts a credit memo request for ${row.agreement.currency} ${row.agreement.accruedAmount.toLocaleString("en-IN")} against ${row.agreement.kunnr} and closes the agreement (KONA-BOSTA = D).`}
                          confirmLabel="Settle it"
                          disabled={!row.state.settleable}
                          disabledReason={
                            row.state.code === "D" ? "Settled" : "Not released (VBO2)"
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

      {tab === "reconciliation" ? (
        <section className="flex flex-col gap-3">
          <ReconciliationTray tenantId={session.tenantId} />
        </section>
      ) : null}
    </>
  );
}
