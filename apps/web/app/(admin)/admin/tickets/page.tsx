import { TICKET_CATEGORY_DEFS, TICKET_PRIORITY_DEFS, TICKET_STATUS_DEFS } from "@cc/domain";
import { listWorkbench, type WorkbenchFilter } from "@cc/service-support";
import { DocumentNumber, formatDisplayDate, PageHeader, SlaChip, StatusBadge } from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WorkbenchFilterChips } from "./WorkbenchFilterChips";

import { getSession } from "@/lib/session";

/**
 * The ticket workbench (docs/07 A3: "admin ticket workbench `/admin/tickets`
 * (SLA-sorted)", docs/05 §8).
 *
 * Sorted most-urgent-then-oldest, which is the opposite of the customer's own
 * list and deliberately so: an agent *is* managing a queue, and the question
 * they open this screen with is "what is about to breach?".
 *
 * The sort is done in SQL, not in memory. Within a priority the deadline is a
 * fixed offset from `openedAt`, so ordering by priority then `openedAt` **is**
 * ordering by deadline — and the enum's declaration order (critical → low)
 * makes ascending mean most-urgent-first by construction.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly WorkbenchFilter[] = ["open", "unassigned", "mine", "breached", "all"];

export default async function TicketWorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "open";

  const result = await listWorkbench(
    { tenantId: session.tenantId, userId: session.userId },
    { filter },
  );

  return (
    <>
      <PageHeader
        title="Ticket Workbench"
        subtitle="Most urgent first. A ticket past its SLA is flagged and has already raised a breach event."
      />

      <WorkbenchFilterChips active={filter} counts={result.counts} />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Ticket
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Account
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Subject
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Category
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Priority
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Raised
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                SLA
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.tickets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
                  {filter === "breached"
                    ? "Nothing has breached its SLA. Good."
                    : "No tickets match this filter."}
                </td>
              </tr>
            ) : (
              result.tickets.map((ticket) => (
                <tr key={ticket.id} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber value={ticket.ticketNo} href={`/admin/tickets/${ticket.id}`} />
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[11px] text-text-mid">
                    {ticket.customerKunnr}
                  </td>
                  <td className="max-w-[20rem] px-4 py-2.5 align-top">
                    <Link
                      href={`/admin/tickets/${ticket.id}`}
                      className="text-text-mid underline-offset-2 hover:underline"
                    >
                      {ticket.subject}
                    </Link>
                    {ticket.assigneeUserId ? null : (
                      <span className="mt-0.5 block text-[11px] font-medium text-warning">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {TICKET_CATEGORY_DEFS[ticket.category].label}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {TICKET_PRIORITY_DEFS[ticket.priority].label}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid tabular-nums">
                    {formatDisplayDate(ticket.openedAt)}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <SlaChip sla={ticket.sla} dense />
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <StatusBadge status={TICKET_STATUS_DEFS[ticket.status].status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
