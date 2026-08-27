import { hasPermission, TICKET_CATEGORY_DEFS, TICKET_STATUS_DEFS } from "@cc/domain";
import { listTickets, type TicketListFilter } from "@cc/service-support";
import {
  DocumentNumber,
  formatDisplayDate,
  PageHeader,
  Pager,
  SapUnavailable,
  SlaChip,
  StatusBadge,
} from "@cc/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SupportFilterChips } from "./SupportFilterChips";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * Ticket list (docs/03 Screen 8.2, docs/05 §7.8 "Track").
 *
 * Sorted newest-activity-first, not by SLA. A customer is not managing a
 * queue — they are checking on the thing they last spoke to somebody about.
 * The workbench sorts the other way, deliberately.
 */

export const dynamic = "force-dynamic";

const FILTERS: readonly TicketListFilter[] = ["all", "open", "resolved", "closed"];
const PAGE_SIZE = 10;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const requested = Array.isArray(params.filter) ? params.filter[0] : params.filter;
  const filter = FILTERS.find((f) => f === requested) ?? "all";
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const offset = Math.max(0, Number(pageParam ?? 1) - 1) * PAGE_SIZE;

  const canCreate = hasPermission(session, "support:create");

  if (!session.kunnr) {
    return (
      <>
        <PageHeader title="Support" />
        <p className="rounded-md border border-border bg-surface p-8 text-center text-[12.5px] text-text-dim">
          Your login isn&apos;t linked to a sold-to account, so there are no tickets to show. Ask
          your administrator to link one.
        </p>
      </>
    );
  }

  const result = await safeRead(() =>
    listTickets(
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      { filter, limit: PAGE_SIZE, offset },
    ),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="Support"
          subtitle={`Queries raised for account ${session.kunnr}.`}
          actions={
            canCreate ? (
              <Link
                href="/support/new"
                className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors duration-micro hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Raise a ticket
              </Link>
            ) : null
          }
        />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const { tickets, counts, total } = result.data;

  return (
    <>
      <PageHeader
        title="Support"
        subtitle={`Queries raised for account ${session.kunnr}.`}
        actions={
          canCreate ? (
            <Link
              href="/support/new"
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors duration-micro hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Raise a ticket
            </Link>
          ) : null
        }
      />

      <SupportFilterChips active={filter} counts={counts} />

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Ticket
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Subject
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Category
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
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-[12.5px] text-text-dim">
                    {filter === "all"
                      ? "No tickets yet. Raise one and we'll pick it up."
                      : "No tickets match this filter right now."}
                  </p>
                  {/* Doc 05 §6.3: an empty state carries its next step. */}
                  {canCreate ? (
                    <Link
                      href="/support/new"
                      className="mt-2 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                    >
                      Raise a ticket
                    </Link>
                  ) : null}
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => (
                <tr key={ticket.id} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <DocumentNumber value={ticket.ticketNo} href={`/support/${ticket.id}`} />
                  </td>
                  <td className="max-w-[22rem] px-4 py-2.5 align-top">
                    <Link
                      href={`/support/${ticket.id}`}
                      className="text-text-mid underline-offset-2 hover:underline"
                    >
                      {ticket.subject}
                    </Link>
                    {ticket.relatedDocNumber ? (
                      <span className="mt-0.5 block font-mono text-[11px] text-text-dim">
                        {ticket.relatedDocNumber}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {TICKET_CATEGORY_DEFS[ticket.category].label}
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid tabular-nums">
                    {formatDisplayDate(ticket.openedAt)}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    {/* Closed tickets have nothing left to be late for. */}
                    {ticket.status === "closed" ? (
                      <span className="text-text-dim">—</span>
                    ) : (
                      <SlaChip sla={ticket.sla} dense />
                    )}
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

      <Pager
        total={total}
        pageSize={PAGE_SIZE}
        offset={offset}
        hrefFor={(next) =>
          `/support?${new URLSearchParams({
            ...(filter !== "all" ? { filter } : {}),
            page: String(Math.floor(next / PAGE_SIZE) + 1),
          })}`
        }
      />
    </>
  );
}
