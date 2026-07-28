import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type {
  TicketCategory,
  TicketCommentInput,
  TicketPriority,
  TicketResolveInput,
  TicketStatus,
} from "@cc/domain";
import {
  canTransitionTicket,
  TICKET_PRIORITIES,
  ticketCommentSchema,
  ticketResolveSchema,
} from "@cc/domain";

import { describeAttachments } from "./attachment-service";
import { invalidFrom, SupportError } from "./errors";
import {
  readOwnedTicket,
  TICKET_LIST_SELECT,
  toSummary,
  type TicketRecord,
  type TicketSummary,
} from "./ticket-store";

/**
 * Service & Support, tenant back office (docs/05 §7.8, docs/07 A3 "admin
 * ticket workbench `/admin/tickets` (SLA-sorted)").
 *
 * The plane is the difference, and it is a real one rather than a cosmetic
 * split: an agent sees every ticket in the tenant (no KUNNR boundary — the
 * boundary is the tenant), sees internal notes, and may resolve. A customer
 * can do none of those. The two files exist so that the wider capability is
 * only reachable through functions the `support:resolve` guard protects; a
 * route that called the customer functions could not accidentally acquire it.
 */

export interface AgentContext {
  tenantId: string;
  userId?: string;
}

// ---- The queue ------------------------------------------------------------

export type WorkbenchFilter = "open" | "unassigned" | "mine" | "breached" | "all";

export interface WorkbenchQuery {
  filter?: WorkbenchFilter;
  category?: TicketCategory;
  priority?: TicketPriority;
}

export interface WorkbenchResult {
  tickets: TicketSummary[];
  total: number;
  counts: Record<WorkbenchFilter, number>;
}

const OPEN_STATUSES: TicketStatus[] = ["open", "in_progress"];

/**
 * The workbench queue, sorted by urgency rather than recency: an agent *is*
 * managing a queue, and the question they open this screen with is "what is
 * about to breach?".
 *
 * The sort is priority first, then oldest-opened, which is the same order
 * `slaView` would produce for tickets of equal priority — but computed in SQL
 * rather than in memory, because the deadline is a fixed offset from
 * `openedAt` within a priority, so ordering by `openedAt` inside a priority
 * band *is* ordering by deadline. Sorting in memory would mean paging the
 * whole table into the process to find the top twenty.
 */
export async function listWorkbench(
  context: AgentContext,
  query: WorkbenchQuery = {},
): Promise<WorkbenchResult> {
  const filter = query.filter ?? "open";
  const now = new Date();

  const rows = await runWithTenant(context.tenantId, () =>
    db.supportTicket.findMany({
      where: {
        ...whereForFilter(filter, context.userId),
        ...(query.category ? { category: query.category } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
      },
      // `priority` ascending is most-urgent-first: Postgres orders an enum by
      // its declaration order, and the enum is declared critical → low. The
      // registry's list order and the database's agree by construction, not
      // by anyone remembering to keep them in step.
      orderBy: [{ priority: "asc" }, { openedAt: "asc" }],
      select: TICKET_LIST_SELECT,
    }),
  );

  const counts = await countFilters(context);

  return { tickets: rows.map((row) => toSummary(row, now)), total: rows.length, counts };
}

function whereForFilter(filter: WorkbenchFilter, userId: string | undefined) {
  switch (filter) {
    case "all":
      return {};
    case "open":
      return { status: { in: OPEN_STATUSES } };
    case "unassigned":
      return { status: { in: OPEN_STATUSES }, assigneeUserId: null };
    case "mine":
      // An agent with no user id sees an empty "mine" rather than everyone
      // else's work — the alternative is a filter that silently means "all".
      return { status: { in: OPEN_STATUSES }, assigneeUserId: userId ?? "__none__" };
    case "breached":
      return { status: { in: OPEN_STATUSES }, slaBreachedAt: { not: null } };
  }
}

async function countFilters(context: AgentContext): Promise<Record<WorkbenchFilter, number>> {
  const count = (filter: WorkbenchFilter) =>
    runWithTenant(context.tenantId, () =>
      db.supportTicket.count({ where: whereForFilter(filter, context.userId) }),
    );

  const [all, open, unassigned, mine, breached] = await Promise.all([
    count("all"),
    count("open"),
    count("unassigned"),
    count("mine"),
    count("breached"),
  ]);
  return { all, open, unassigned, mine, breached };
}

/**
 * One ticket, back-office view — internal notes included, no KUNNR check.
 * The absence of that check is why this is a separate function rather than a
 * flag on the customer one: a boolean parameter is a boundary that can be
 * passed the wrong way round.
 */
export async function getTicketForAgent(
  context: AgentContext,
  ticketId: string,
): Promise<TicketRecord> {
  return readOwnedTicket(context.tenantId, ticketId, { visibility: "agent" });
}

// ---- Assignment -----------------------------------------------------------

export async function assignTicket(
  context: AgentContext,
  ticketId: string,
  assigneeUserId: string | null,
): Promise<TicketRecord> {
  await getTicketForAgent(context, ticketId);

  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({ where: { id: ticketId }, data: { assigneeUserId } }),
  );

  return getTicketForAgent(context, ticketId);
}

// ---- Transitions ----------------------------------------------------------

export async function transitionTicketAsAgent(
  context: AgentContext,
  ticketId: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const ticket = await getTicketForAgent(context, ticketId);

  if (!canTransitionTicket(ticket.status, to, "agent")) throw new SupportError("not_allowed");
  if (to === "resolved") {
    // Resolving needs the resolution text, so it has its own entry point.
    throw new SupportError("invalid", {
      issues: [{ field: "resolution", message: "Say what was done to resolve this." }],
    });
  }

  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({
      where: { id: ticketId },
      data:
        to === "in_progress"
          ? // Keep the original start if the ticket has been here before: the
            // second time an agent picks a ticket up is not the first time
            // work began on it.
            { status: "in_progress", startedAt: ticket.startedAt ?? new Date() }
          : to === "open"
            ? {
                status: "open",
                openedAt: new Date(),
                startedAt: null,
                resolvedAt: null,
                slaBreachedAt: null,
              }
            : { status: "closed", closedAt: new Date() },
    }),
  );

  return getTicketForAgent(context, ticketId);
}

/**
 * Resolve (docs/03 Screen 8.2 "Resolution notes + date").
 *
 * `resolvedAt` is what stops the SLA clock, and the event that tells the
 * customer is written in the same transaction as the resolution (ADR-023) —
 * a resolution nobody was told about starts a 7-day reopen window the
 * customer doesn't know is running.
 */
export async function resolveTicket(
  context: AgentContext,
  ticketId: string,
  input: TicketResolveInput,
): Promise<TicketRecord> {
  const parsed = ticketResolveSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const ticket = await getTicketForAgent(context, ticketId);
  if (!canTransitionTicket(ticket.status, "resolved", "agent")) {
    throw new SupportError("not_allowed");
  }

  const resolvedAt = new Date();

  await runWithTenant(context.tenantId, () =>
    db.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: "resolved", resolvedAt, resolution: parsed.data.resolution },
      });

      await writeOutboxEvent(tx, {
        name: "support.ticket.resolved",
        payload: {
          occurredAt: resolvedAt,
          ticketId: ticket.id,
          ticketNo: ticket.ticketNo,
          kunnr: ticket.customerKunnr,
          resolvedByUserId: context.userId,
        },
        // The resolution, not the ticket: a reopened-then-resolved ticket is
        // a second resolution the customer must be told about.
        dedupeKey: `support.ticket.resolved:${ticket.id}:${resolvedAt.toISOString()}`,
      });
    }),
  );

  return getTicketForAgent(context, ticketId);
}

// ---- Thread ---------------------------------------------------------------

/**
 * Comment as an agent. This is the only path that may write an internal note,
 * and the flag is taken from the parsed input rather than assumed — an agent
 * posts both kinds from the same box, with a toggle.
 */
export async function addAgentComment(
  context: AgentContext,
  ticketId: string,
  input: TicketCommentInput,
): Promise<TicketRecord> {
  const parsed = ticketCommentSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  await getTicketForAgent(context, ticketId);

  const attachments = await describeAttachments(parsed.data.attachmentKeys);

  await runWithTenant(context.tenantId, () =>
    db.ticketComment.create({
      data: {
        tenantId: context.tenantId,
        ticketId,
        authorUserId: context.userId,
        authorIsAgent: true,
        body: parsed.data.body,
        internal: parsed.data.internal,
        attachments: {
          create: attachments.map((file) => ({
            tenantId: context.tenantId,
            ticketId,
            storageKey: file.storageKey,
            fileName: file.fileName,
            contentType: file.contentType,
            sizeBytes: file.sizeBytes,
            uploadedByUserId: context.userId,
          })),
        },
      },
    }),
  );

  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({ where: { id: ticketId }, data: {} }),
  );

  return getTicketForAgent(context, ticketId);
}

/** Priorities in workbench sort order, for the filter chips. */
export const WORKBENCH_PRIORITIES = TICKET_PRIORITIES;
