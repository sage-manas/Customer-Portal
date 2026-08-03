import { getLoyaltyPosition } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  formatDisplayDate,
  Money,
  PageHeader,
  SapSyncIndicator,
  StaleDataBanner,
  TierProgress,
} from "@cc/ui";
import { redirect } from "next/navigation";

import { AccountTabs } from "../AccountTabs";

import { getSession } from "@/lib/session";

/**
 * Loyalty & rebates (docs/03 Screen 9.2, docs/05 §7.9).
 *
 * The tier is computed on this request from the customer's fiscal-year
 * billing and the tenant's thresholds; nothing about it is stored, so a tenant
 * that changes its ladder changes this page the next time it loads and there
 * is no cached tier anywhere to contradict it.
 *
 * The accrued rebate is KONA-KAWRT exactly as SAP holds it. The portal does
 * not compute it, for the same reason it does not compute GST: it is money
 * owed to a customer, and a second answer is a dispute.
 */

export const dynamic = "force-dynamic";

export default async function LoyaltyPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Account" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there&apos;s no purchase history to
          tier. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const sap = await getSapAdapterForTenant(session.tenantId);
  const loyalty = await getLoyaltyPosition(sap, {
    tenantId: session.tenantId,
    kunnr: session.kunnr,
    userId: session.userId,
  });

  return (
    <>
      {loyalty.freshness === "stale" ? <StaleDataBanner syncedAt={loyalty.syncedAt} /> : null}

      <PageHeader
        title="Account"
        subtitle={`Loyalty standing for account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={loyalty.freshness} syncedAt={loyalty.syncedAt} />}
      />

      <AccountTabs />

      <section className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <TierProgress standing={loyalty.standing} fiscalYearLabel={loyalty.fiscalYear.label} />
        <p className="mt-4 border-t border-border pt-3 text-[11.5px] text-text-dim">
          Counted from invoices billed between {formatDisplayDate(loyalty.fiscalYear.start)} and{" "}
          {formatDisplayDate(loyalty.fiscalYear.end)}, net of credit notes.
        </p>
      </section>

      <section className="rounded-md border border-border bg-surface shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-bold text-text">Rebate agreements</h2>
            <p className="text-[11.5px] text-text-dim">
              What you&apos;ve accrued so far, as calculated in our system.
            </p>
          </div>
          {loyalty.rebates.length > 0 ? (
            <p className="text-right">
              <span className="block text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                Accrued
              </span>
              <Money value={loyalty.accruedRebate} className="text-[15px] font-bold" />
            </p>
          ) : null}
        </header>

        {loyalty.rebates.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-dim">
            You don&apos;t have a rebate agreement running at the moment. Your account manager can
            tell you whether one applies.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Agreement
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Running
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Accrued
                  </th>
                </tr>
              </thead>
              <tbody>
                {loyalty.rebates.map((rebate) => (
                  <tr key={rebate.agreementNumber} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <span className="block font-mono text-[12px]">{rebate.agreementNumber}</span>
                      <span className="text-[11.5px] text-text-dim">{rebate.description}</span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-text-mid">
                      {formatDisplayDate(rebate.validFrom)} – {formatDisplayDate(rebate.validTo)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={rebate.accruedAmount} className="font-semibold" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
