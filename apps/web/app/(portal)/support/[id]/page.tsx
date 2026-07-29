import {
  availableTicketTransitions,
  canRateTicket,
  canReopenTicket,
  hasPermission,
  TICKET_CATEGORY_DEFS,
  TICKET_PRIORITY_DEFS,
  TICKET_STATUS_DEFS,
} from "@cc/domain";
import { getTicket, isSupportError } from "@cc/service-support";
import {
  CommentThread,
  DocumentNumber,
  formatDisplayDate,
  PageHeader,
  SlaChip,
  StatusBadge,
  TicketTimeline,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TicketActions } from "./TicketActions";

import { getSession } from "@/lib/session";

/**
 * Ticket detail (docs/03 Screen 8.2, docs/05 §7.8 "Track").
 *
 * A ticket that isn't this customer's raises `not_found` in the service and
 * lands on the 404 page — never a 403, which would confirm it exists
 * (CLAUDE.md rule 5).
 *
 * Every "can they?" on this page is answered by a `@cc/domain` function, not
 * by a condition written here: which buttons appear comes from
 * `availableTicketTransitions`, whether Reopen is still allowed from
 * `canReopenTicket`, whether the rating form shows from `canRateTicket`. The
 * API re-asks all three — hiding a control is presentation, the route handler
 * is the control (docs/05 §4.3).
 */

export const dynamic = "force-dynamic";

const DOC_HREF = {
  order: "/orders",
  delivery: "/deliveries",
  invoice: "/invoices",
} as const;

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const ticket = await getTicket(
    { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
    id,
  ).catch((error: unknown) => {
    if (isSupportError(error) && error.code === "not_found") notFound();
    throw error;
  });

  const canAct = hasPermission(session, "support:create");

  // Reopen is on the transition table *and* time-bounded, so it is filtered by
  // both — the registry says a customer may reopen a resolved ticket, and
  // `canReopenTicket` says whether this one is still inside its 7-day window.
  const transitions = availableTicketTransitions(ticket.status, "customer")
    .filter((transition) => transition.to !== "open" || canReopenTicket(ticket))
    .map((transition) => ({ to: transition.to, label: transition.label }));

  const category = TICKET_CATEGORY_DEFS[ticket.category];
  const priority = TICKET_PRIORITY_DEFS[ticket.priority];

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={`Ticket ${ticket.ticketNo} · raised ${formatDisplayDate(ticket.openedAt)}`}
        meta={<StatusBadge status={TICKET_STATUS_DEFS[ticket.status].status} />}
        actions={ticket.status === "closed" ? null : <SlaChip sla={ticket.sla} />}
      />

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <TicketTimeline stages={ticket.timeline} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-[13px] font-bold text-text">What you told us</h2>
            {/* Text, never markup — a support thread is where error messages
                full of angle brackets get pasted. */}
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-text-mid">
              {ticket.description}
            </p>

            {ticket.attachments.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {ticket.attachments.map((file) => (
                  <li
                    key={file.id}
                    className="rounded-pill border border-border bg-background px-2 py-0.5 text-[11px] text-text-mid"
                  >
                    {file.fileName}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {ticket.resolution ? (
            <section className="rounded-md border border-success-border bg-success-subtle p-5">
              <h2 className="text-[13px] font-bold text-text">How we resolved it</h2>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-text-mid">
                {ticket.resolution}
              </p>
              {ticket.status === "resolved" && canReopenTicket(ticket) ? (
                <p className="mt-2 text-[11px] text-text-dim">
                  Not right? You can reopen this ticket for 7 days after it was resolved.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold text-text">Conversation</h2>
            <CommentThread
              comments={ticket.comments.map((comment) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt,
                authorIsAgent: comment.authorIsAgent,
                internal: comment.internal,
                attachments: comment.attachments.map((file) => ({
                  id: file.id,
                  fileName: file.fileName,
                  sizeBytes: file.sizeBytes,
                })),
              }))}
            />

            {canAct ? (
              <div className="mt-4 border-t border-border pt-4">
                <TicketActions
                  ticketId={ticket.id}
                  transitions={transitions}
                  canComment={ticket.status !== "closed"}
                  canRate={canRateTicket(ticket)}
                />
              </div>
            ) : null}
          </section>
        </div>

        <aside className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-[13px] font-bold text-text">Details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2.5 text-[12.5px]">
            <dt className="text-text-dim">Ticket number</dt>
            <dd className="font-mono text-text-mid">{ticket.ticketNo}</dd>

            <dt className="text-text-dim">Category</dt>
            <dd className="text-text-mid">{category.label}</dd>

            <dt className="text-text-dim">Priority</dt>
            <dd className="text-text-mid">{priority.label}</dd>

            <dt className="text-text-dim">Response due</dt>
            <dd className="text-text-mid tabular-nums">{formatDisplayDate(ticket.sla.deadline)}</dd>

            {ticket.relatedDocType && ticket.relatedDocNumber ? (
              <>
                <dt className="text-text-dim">Related {ticket.relatedDocType}</dt>
                <dd>
                  <DocumentNumber
                    value={ticket.relatedDocNumber}
                    href={`${DOC_HREF[ticket.relatedDocType]}/${ticket.relatedDocNumber}`}
                  />
                </dd>
              </>
            ) : null}

            {ticket.rating != null ? (
              <>
                <dt className="text-text-dim">Your rating</dt>
                <dd className="text-text-mid">{ticket.rating} of 5</dd>
              </>
            ) : null}
          </dl>

          <Link
            href="/support"
            className="mt-2 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Back to all tickets
          </Link>
        </aside>
      </div>
    </>
  );
}
