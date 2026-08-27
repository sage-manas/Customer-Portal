import { hasPermission } from "@cc/domain";
import { listInquiryQueue } from "@cc/service-inquiry";
import { listRefundQueue } from "@cc/service-invoice";
import { listCreditRequestQueue, listRebateSettlements } from "@cc/service-loyalty";
import { listApplications } from "@cc/service-onboarding";
import { listCreditBlockedOrders } from "@cc/service-order";
import { getTenantLedger, listDunningCandidates } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { listWorkbench } from "@cc/service-support";
import { KpiCard, Money, PageHeader } from "@cc/ui";
import { FileCheck, FileSignature, Headphones, Landmark, ShieldCheck, Wallet } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/lib/session";

/**
 * Tenant back-office overview (docs/05-UI-UX-DESIGN.md §8).
 *
 * One page, three audiences: `client_admin` holds every permission below and
 * sees every card; `ap_manager`/`ar_manager` hold only their own desk's
 * permission and see only that desk's card. The same `hasPermission` checks
 * that filter `ADMIN_NAV` (packages/domain/navigation.ts) decide what's
 * fetched here, so a card never appears for data the session isn't allowed
 * to read.
 *
 * Each card reads through the same service function its full screen does —
 * no separate "summary" endpoint to keep in sync with the desk it summarizes.
 */

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const sap = await getSapAdapterForTenant(session.tenantId);
  const context = { tenantId: session.tenantId, userId: session.userId };

  const [onboarding, quotations, credit, tickets, ap, ar] = await Promise.all([
    hasPermission(session, "onboarding:review")
      ? listApplications(session.tenantId, { status: "PendingApproval" }).catch(() => null)
      : null,
    hasPermission(session, "quotation:issue") ? listInquiryQueue(sap).catch(() => null) : null,
    hasPermission(session, "credit:decide-limit")
      ? listCreditRequestQueue(context, { filter: "pending" }).catch(() => null)
      : null,
    hasPermission(session, "support:resolve")
      ? listWorkbench(context, { filter: "open" }).catch(() => null)
      : null,
    hasPermission(session, "finance:ap")
      ? Promise.all([
          listRefundQueue(sap).catch(() => null),
          listRebateSettlements(sap).catch(() => null),
        ])
      : null,
    hasPermission(session, "finance:ar")
      ? Promise.all([
          getTenantLedger(sap).catch(() => null),
          listDunningCandidates(sap).catch(() => null),
          hasPermission(session, "credit:release")
            ? listCreditBlockedOrders(sap).catch(() => null)
            : null,
        ])
      : null,
  ]);

  const [refunds, rebates] = ap ?? [null, null];
  const [ledger, dunning, blockedOrders] = ar ?? [null, null, null];

  const cards: ReactNode[] = [];

  if (onboarding) {
    cards.push(
      <KpiCard
        key="onboarding"
        label="Onboarding Queue"
        value={String(onboarding.length)}
        subline="awaiting review"
        icon={FileCheck}
        accent="onboard"
        href="/admin/onboarding"
      />,
    );
  }

  if (quotations) {
    cards.push(
      <KpiCard
        key="quotations"
        label="Quotation Workbench"
        value={String(quotations.total)}
        subline="inquiries waiting on a quote"
        icon={FileSignature}
        accent="inquiry"
        href="/admin/quotations"
      />,
    );
  }

  if (credit) {
    cards.push(
      <KpiCard
        key="credit"
        label="Credit Desk"
        value={String(credit.counts.pending)}
        subline="requests pending a decision"
        icon={ShieldCheck}
        accent="payment"
        href="/admin/credit"
      />,
    );
  }

  if (tickets) {
    cards.push(
      <KpiCard
        key="tickets"
        label="Ticket Workbench"
        value={String(tickets.counts.open)}
        subline="open tickets"
        icon={Headphones}
        accent="support"
        href="/admin/tickets"
      />,
    );
  }

  if (refunds) {
    cards.push(
      <KpiCard
        key="ap"
        label="Accounts Payable"
        value={String(refunds.refunds.length + (rebates?.rows.length ?? 0))}
        subline={<Money value={refunds.totalOwed + (rebates?.releasedValue ?? 0)} />}
        icon={Wallet}
        accent="payment"
        href="/admin/ap"
      />,
    );
  }

  if (ledger) {
    cards.push(
      <KpiCard
        key="ar"
        label="Accounts Receivable"
        value={<Money value={ledger.totalOutstanding} />}
        subline={
          dunning
            ? `${dunning.candidates.length} overdue · ${blockedOrders ? blockedOrders.rows.length : 0} credit-blocked`
            : "outstanding"
        }
        icon={Landmark}
        accent="invoice"
        href="/admin/ar"
      />,
    );
  }

  return (
    <>
      <PageHeader title="Tenant Back-Office" subtitle="Today's queues, at a glance." />

      {cards.length === 0 ? (
        <section className="rounded-md border border-border bg-surface p-8 text-center shadow-sm">
          <p className="text-[13px] font-semibold text-text">Nothing to show yet.</p>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-text-dim">
            Your role doesn&apos;t hold a permission any of these desks are gated on.
          </p>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards}</section>
      )}
    </>
  );
}
