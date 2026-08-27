import {
  availableTicketTransitions,
  canTransitionTicket,
  TICKET_CATEGORY_DEFS,
  TICKET_PRIORITY_DEFS,
  TICKET_STATUS_DEFS,
} from "@cc/domain";
import { getTicketForAgent, isSupportError } from "@cc/service-support";
import {
  CommentThread,
  DocumentNumber,
  formatDisplayDate,
  PageHeader,
  SapUnavailable,
  SlaChip,
  StatusBadge,
  TicketTimeline,
} from "@cc/ui";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AgentPanel } from "./AgentPanel";

import { safeRead } from "@/lib/safe-read";
import { getSession } from "@/lib/session";

/**
 * One ticket in the workbench (docs/05 §7.8, docs/03 Screen 8.2).
 *
 * The customer's page and this one are separate files reading through separate
 * service functions, and that is the point rather than duplication: this read
 * has **no KUNNR check** and **includes internal notes**. A single page with a
 * mode flag would be one wrong boolean away from showing a customer the team's
 * private notes.
 */

export const dynamic = "force-dynamic";

const DOC_HREF = {
  order: "/orders",
  delivery: "/deliveries",
  invoice: "/invoices",
} as const;

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const result = await safeRead(() =>
    getTicketForAgent(
      { tenantId: session.tenantId, userId: session.userId },
      id,
    ).catch((error: unknown) => {
      if (isSupportError(error) && error.code === "not_found") notFound();
      throw error;
    }),
  );

  if (!result.ok) {
    return (
      <>
        <PageHeader title={`Ticket ${id}`} />
        <SapUnavailable reason={result.reason} />
      </>
    );
  }

  const ticket = result.data;

  const transitions = availableTicketTransitions(ticket.status, "agent").map((transition) => ({
    to: transition.to,
    label: transition.label,
  }));

  const category = TICKET_CATEGORY_DEFS[ticket.category];
  const priority = TICKET_PRIORITY_DEFS[ticket.priority];

  return (
    <>
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.ticketNo} · account ${ticket.customerKunnr} · raised ${formatDisplayDate(
          ticket.openedAt,
        )}`}
        meta={<StatusBadge status={TICKET_STATUS_DEFS[ticket.status].status} />}
        actions={<SlaChip sla={ticket.sla} />}
      />

      {ticket.slaBreachedAt ? (
        <p className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger">
          This ticket breached its SLA on {formatDisplayDate(ticket.slaBreachedAt)}. An escalation
          event has already been raised.
        </p>
      ) : null}

      <div className="rounded-md border border-border bg-surface p-5 shadow-sm">
        <TicketTimeline stages={ticket.timeline} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="text-[13px] font-bold text-text">What the customer reported</h2>
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

          <section className="rounded-md border border-border bg-surface p-5 shadow-sm">
            <h2 className="mb-3 text-[13px] font-bold text-text">Conversation</h2>
            <CommentThread
              emptyLabel="Nothing on the thread yet."
              comments={ticket.comments.map((comment) => ({
                id: comment.id,
                body: comment.body,
                createdAt: comment.createdAt,
                authorIsAgent: comment.authorIsAgent,
                authorName: comment.authorIsAgent ? "Support team" : "Customer",
                internal: comment.internal,
                attachments: comment.attachments.map((file) => ({
                  id: file.id,
                  fileName: file.fileName,
                  sizeBytes: file.sizeBytes,
                })),
              }))}
            />

            <div className="mt-4 border-t border-border pt-4">
              <AgentPanel
                ticketId={ticket.id}
                transitions={transitions}
                canResolve={canTransitionTicket(ticket.status, "resolved", "agent")}
                assigned={ticket.assigneeUserId === session.userId}
              />
            </div>
          </section>
        </div>

        <aside className="rounded-md border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-[13px] font-bold text-text">Details</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-2.5 text-[12.5px]">
            <dt className="text-text-dim">Ticket</dt>
            <dd className="font-mono text-text-mid">{ticket.ticketNo}</dd>

            <dt className="text-text-dim">Account</dt>
            <dd className="font-mono text-text-mid">{ticket.customerKunnr}</dd>

            <dt className="text-text-dim">Category</dt>
            <dd className="text-text-mid">{category.label}</dd>

            <dt className="text-text-dim">Priority</dt>
            <dd className="text-text-mid">
              {priority.label}
              <span className="ml-1 text-text-dim">({priority.slaHours}h)</span>
            </dd>

            <dt className="text-text-dim">Routes to</dt>
            <dd className="text-text-mid">{category.routesTo.replace("tenant_", "")}</dd>

            <dt className="text-text-dim">Assigned</dt>
            <dd className="text-text-mid">
              {ticket.assigneeUserId
                ? ticket.assigneeUserId === session.userId
                  ? "You"
                  : "Another agent"
                : "Nobody"}
            </dd>

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
                <dt className="text-text-dim">CSAT</dt>
                <dd className="text-text-mid">{ticket.rating} of 5</dd>
              </>
            ) : null}
          </dl>

          {ticket.ratingComment ? (
            <p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-[12px] text-text-mid">
              “{ticket.ratingComment}”
            </p>
          ) : null}

          <Link
            href="/admin/tickets"
            className="mt-3 inline-block text-[12px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Back to the workbench
          </Link>
        </aside>
      </div>
    </>
  );
}
