import { hasPermission } from "@cc/domain";
import { getCreditPosition, listCreditRequests } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  CreditGauge,
  formatDisplayDate,
  Money,
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  StatusBadge,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountTabs } from "./AccountTabs";
import { WithdrawRequestButton } from "./WithdrawRequestButton";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Credit position (docs/03 Screen 9.1, docs/05 §7.9).
 *
 * Every figure on this page is a SAP read composed on request — nothing about
 * a customer's credit is stored, so the page carries its freshness and says so
 * rather than claiming to be live (ADR-007). The one thing below that *is* a
 * portal row is the request history, and it is deliberately rendered apart
 * from the gauge: a request the credit team approved has not changed the
 * limit above it, and the two must not read as one thing.
 */

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Account" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there&apos;s no credit position to
          show. Ask your administrator to link one.
        </p>
      </>
    );
  }

  const context = { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId };
  const sap = await getSapAdapterForTenant(session.tenantId);

  const read = await safeRead(() =>
    Promise.all([getCreditPosition(sap, context), listCreditRequests(context)]),
  );

  if (!read.ok) {
    return (
      <>
        <PageHeader
          title="Account"
          subtitle={`Credit and loyalty standing for account ${session.kunnr}.`}
        />
        <SapUnavailable reason={read.reason} />
      </>
    );
  }

  const [credit, requests] = read.data;

  const canRequest = hasPermission(session, "credit:request");

  return (
    <>
      {credit.freshness === "stale" ? <StaleDataBanner syncedAt={credit.syncedAt} /> : null}

      <PageHeader
        title="Account"
        subtitle={`Credit and loyalty standing for account ${session.kunnr}.`}
        meta={<SapSyncIndicator state={credit.freshness} syncedAt={credit.syncedAt} />}
      />

      <AccountTabs />

      <section className="rounded-md border border-border bg-surface p-6 shadow-sm">
        <CreditGauge position={credit.position} />
      </section>

      <section className="rounded-md border border-border bg-surface shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[13px] font-bold text-text">Credit limit requests</h2>
            <p className="text-[11.5px] text-text-dim">
              Asking here starts a review by our credit team. Your limit changes once they apply it.
            </p>
          </div>
          {canRequest && !requests.pending ? (
            <Link
              href="/account/credit/request"
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors duration-micro hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Request an increase
            </Link>
          ) : null}
        </header>

        {requests.requests.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-text-dim">
            You haven&apos;t asked for a credit-limit change.
            {/* Doc 05 §6.3: an empty state carries its next step. */}
            {canRequest ? (
              <Link
                href="/account/credit/request"
                className="ml-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                Request an increase
              </Link>
            ) : null}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                  <th scope="col" className="px-4 py-2 font-bold">
                    Asked
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Requested
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-bold">
                    Limit at the time
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-bold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.requests.map((request) => (
                  <tr key={request.id} className="border-t border-border align-top">
                    <td className="px-4 py-2.5 tabular-nums text-text-mid">
                      {formatDisplayDate(request.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={request.requestedLimit} className="font-semibold" />
                    </td>
                    <td className="px-4 py-2.5 text-right text-text-dim">
                      <Money value={request.currentLimit} className="text-text-dim" />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={request.statusDef.status} />
                      {request.status === "approved" && request.approvedLimit !== null ? (
                        <p className="mt-1 text-[11px] text-text-dim">
                          Agreed to <Money value={request.approvedLimit} className="text-[11px]" />{" "}
                          — takes effect once our credit team applies it.
                        </p>
                      ) : null}
                      {request.decisionNote ? (
                        <p className="mt-1 max-w-[24rem] text-[11px] text-text-dim">
                          {request.decisionNote}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {request.status === "pending" && canRequest ? (
                        <WithdrawRequestButton requestId={request.id} />
                      ) : null}
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
