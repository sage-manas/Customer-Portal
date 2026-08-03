import { hasPermission } from "@cc/domain";
import { listCreditRequestQueue, type CreditQueueFilter } from "@cc/service-loyalty";
import { formatDisplayDate, Money, PageHeader, StatusBadge } from "@cc/ui";
import { redirect } from "next/navigation";

import { CreditQueueFilterChips } from "./CreditQueueFilterChips";
import { DecisionPanel } from "./DecisionPanel";

import { getSession } from "@/lib/session";

/**
 * The credit desk (docs/05 §8, docs/07 A5).
 *
 * Oldest first — the opposite sort to the customer's own request list, and
 * deliberately so: a desk is working a backlog, and the request that has
 * waited longest is the one somebody is still waiting on.
 *
 * This screen is **not** scoped to a KUNNR, which is why it lives under
 * `/admin`, is guarded by `credit:decide-limit`, and reads through the desk
 * service rather than the customer's with the account left off (ADR-032).
 *
 * Doc 05 §8 also lists a blocked-order release queue for this desk. That needs
 * a tenant-wide read of credit-blocked sales orders, which the adapter does
 * not have and which must be a method of its own rather than `getOrders` with
 * the KUNNR dropped — so it is not here yet. See the @cc/service-loyalty
 * README.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly CreditQueueFilter[] = ["pending", "decided", "all"];

export default async function CreditDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!hasPermission(session, "credit:decide-limit")) redirect("/403");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "pending";

  const queue = await listCreditRequestQueue(
    { tenantId: session.tenantId, userId: session.userId },
    { filter },
  );

  return (
    <>
      <PageHeader
        title="Credit Desk"
        subtitle="Credit-limit increases customers have asked for, longest-waiting first."
      />

      <CreditQueueFilterChips active={filter} counts={queue.counts} />

      <p className="rounded-md border border-border bg-background px-4 py-2.5 text-[11.5px] text-text-mid">
        Deciding here records the decision and notifies the customer. It does not change KNKK — the
        limit itself is maintained in FD32.
      </p>

      {queue.requests.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          {filter === "pending"
            ? "Nothing waiting. Every request has been answered."
            : "No requests match this filter."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {queue.requests.map((request) => (
            <li
              key={request.id}
              className="rounded-md border border-border bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[13px] font-semibold text-text">
                    {request.customerKunnr}
                  </p>
                  <p className="text-[11.5px] text-text-dim">
                    Asked {formatDisplayDate(request.createdAt)}
                  </p>
                </div>
                <StatusBadge status={request.statusDef.status} />
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                    Requested
                  </dt>
                  <dd>
                    <Money value={request.requestedLimit} className="font-semibold" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                    {/* The limit as it stood when they asked — not as it stands
                        now, which may have moved since (ADR-026's reasoning). */}
                    Limit when asked
                  </dt>
                  <dd className="text-text-mid">
                    <Money value={request.currentLimit} className="text-text-mid" />
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
                    Increase
                  </dt>
                  <dd className="text-text-mid tabular-nums">
                    {request.currentLimit > 0
                      ? `${Math.round((request.requestedLimit / request.currentLimit - 1) * 100)}%`
                      : "—"}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 max-w-3xl border-l-2 border-border pl-3 text-[12.5px] text-text-mid">
                {request.justification}
              </p>

              {request.status === "pending" ? (
                <DecisionPanel requestId={request.id} requestedLimit={request.requestedLimit} />
              ) : (
                <p className="mt-3 text-[11.5px] text-text-dim">
                  {request.statusDef.label}
                  {request.approvedLimit !== null ? (
                    <>
                      {" "}
                      at <Money value={request.approvedLimit} className="text-[11.5px]" />
                    </>
                  ) : null}
                  {request.decidedAt ? ` on ${formatDisplayDate(request.decidedAt)}` : null}
                  {request.decisionNote ? ` — ${request.decisionNote}` : null}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
