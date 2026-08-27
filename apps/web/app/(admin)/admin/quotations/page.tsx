import { listInquiryQueue } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  PageHeader,
  SapSyncIndicator,
  SapUnavailable,
  StaleDataBanner,
  formatDisplayDate,
} from "@cc/ui";
import { redirect } from "next/navigation";

import { IssueQuotationPanel } from "./IssueQuotationPanel";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * The quotation workbench (docs/05 §7.3, §8, docs/07 A4: "list + issue-quote
 * form against mock").
 *
 * Longest-waiting first — the opposite sort to the customer's own inquiry
 * list, and deliberately so: a sales desk is working a queue, and the oldest
 * unanswered inquiry is the one costing the tenant an order.
 *
 * This screen is *not* scoped to a KUNNR, which is exactly why it lives under
 * `/admin`, is guarded by `quotation:issue` in the route handler, and reads
 * through the back-office service and the adapter's own tenant-wide method
 * rather than the customer's.
 */

export const dynamic = "force-dynamic";

/** Default validity offered on the form (VBAK-BNDDT), in days. */
const DEFAULT_VALIDITY_DAYS = 30;

export default async function QuotationWorkbenchPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const sap = await getSapAdapterForTenant(session.tenantId);
  const result = await safeRead(() => listInquiryQueue(sap));

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Quotation Workbench"
          subtitle="Inquiries nobody has answered yet, longest-waiting first."
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const queue = result.data;

  const defaultValidUntil = new Date(Date.now() + DEFAULT_VALIDITY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return (
    <>
      {queue.freshness === "stale" ? <StaleDataBanner syncedAt={queue.syncedAt} /> : null}

      <PageHeader
        title="Quotation Workbench"
        subtitle="Inquiries nobody has answered yet, longest-waiting first."
        meta={<SapSyncIndicator state={queue.freshness} syncedAt={queue.syncedAt} />}
      />

      {queue.inquiries.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Nothing waiting. Every inquiry has a quotation against it.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {queue.inquiries.map((inquiry) => (
            <li
              key={inquiry.vbeln}
              className="rounded-md border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[12.5px] font-semibold text-text">{inquiry.vbeln}</p>
                  <p className="text-[12px] text-text-dim">
                    Account {inquiry.kunnr} · raised {formatDisplayDate(inquiry.createdOn)} ·
                    required by {formatDisplayDate(inquiry.requiredDeliveryDate)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={
                      inquiry.waitingDays >= 2
                        ? "rounded-pill border border-warning-border bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning"
                        : "rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] text-text-dim"
                    }
                  >
                    {inquiry.waitingDays === 0
                      ? "Raised today"
                      : inquiry.waitingDays === 1
                        ? "Waiting 1 day"
                        : `Waiting ${inquiry.waitingDays} days`}
                  </span>
                </div>
              </div>

              {inquiry.notes ? (
                <p className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-[12px] text-text-mid">
                  {inquiry.notes}
                </p>
              ) : null}

              {/* Full width rather than in the header row: the pricing form
                  needs the space, and a cramped one invites a mistyped rate. */}
              <IssueQuotationPanel
                inquiryVbeln={inquiry.vbeln}
                lines={inquiry.lines}
                defaultValidUntil={defaultValidUntil}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
