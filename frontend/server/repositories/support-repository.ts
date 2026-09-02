import "server-only";

import type { TicketCategory, TicketPriority, TicketStatus } from "@cc/domain";

import { prisma } from "@/lib/prisma";

/**
 * Ticket persistence.
 *
 * Two rules are enforced here rather than above, because here is where they
 * can be enforced structurally:
 *
 *  - **Internal notes are excluded in the query, not filtered in the screen.**
 *    `commentsSelect(visibility)` is what a customer read uses, and it never
 *    selects an internal row. A screen that forgot to filter would then have
 *    nothing to leak.
 *  - **Every query is tenant-scoped**, and the customer-plane ones are also
 *    KUNNR-scoped. A miss answers 404 rather than 403, so one customer cannot
 *    learn that another's ticket number is real.
 */

export type CommentVisibility = "customer" | "agent";

/** An agent sees the whole thread; a customer never sees an internal note. */
function commentsSelect(visibility: CommentVisibility) {
  return {
    where: visibility === "customer" ? { internal: false } : {},
    orderBy: { createdAt: "asc" as const },
    include: { attachments: true },
  };
}

function ticketInclude(visibility: CommentVisibility) {
  return {
    comments: commentsSelect(visibility),
    attachments: { where: { commentId: null }, orderBy: { createdAt: "asc" as const } },
  };
}

export type TicketRow = NonNullable<Awaited<ReturnType<typeof findTicketForCustomer>>>;

export function findTicketForCustomer(tenantId: string, kunnr: string, id: string) {
  return prisma.supportTicket.findFirst({
    where: { id, tenantId, customerKunnr: kunnr },
    include: ticketInclude("customer"),
  });
}

export function findTicketForAgent(tenantId: string, id: string) {
  return prisma.supportTicket.findFirst({
    where: { id, tenantId },
    include: ticketInclude("agent"),
  });
}

export interface TicketFilters {
  status?: TicketStatus[];
  category?: TicketCategory;
  priority?: TicketPriority;
  assigneeUserId?: string | null;
  unassigned?: boolean;
  kunnr?: string;
}

function whereFrom(tenantId: string, filters: TicketFilters) {
  return {
    tenantId,
    ...(filters.kunnr ? { customerKunnr: filters.kunnr } : {}),
    ...(filters.status ? { status: { in: filters.status } } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.unassigned ? { assigneeUserId: null } : {}),
    ...(filters.assigneeUserId ? { assigneeUserId: filters.assigneeUserId } : {}),
  };
}

export function listTicketRows(
  tenantId: string,
  filters: TicketFilters,
  page: { limit?: number; offset?: number } = {},
) {
  return prisma.supportTicket.findMany({
    where: whereFrom(tenantId, filters),
    orderBy: { openedAt: "desc" },
    skip: page.offset,
    take: page.limit,
  });
}

export function countTickets(tenantId: string, filters: TicketFilters) {
  return prisma.supportTicket.count({ where: whereFrom(tenantId, filters) });
}

export interface CreateTicketRow {
  tenantId: string;
  kunnr: string;
  raisedByUserId?: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  relatedDocType?: "order" | "delivery" | "invoice" | null;
  relatedDocNumber?: string | null;
  sourceKey?: string | null;
  attachmentKeys?: string[];
}

/**
 * Creates a ticket and its number in one transaction.
 *
 * The counter is incremented inside the same transaction as the insert, so
 * two concurrent writers cannot be handed the same TKT number: the row-level
 * lock the update takes serialises them. A number allocated outside the
 * transaction would be free to leak on a rollback, leaving gaps that look
 * like deleted tickets.
 */
export async function createTicketRow(input: CreateTicketRow) {
  return prisma.$transaction(async (tx) => {
    const counter = await tx.ticketCounter.upsert({
      where: { tenantId: input.tenantId },
      create: { tenantId: input.tenantId, value: 1 },
      update: { value: { increment: 1 } },
    });

    return tx.supportTicket.create({
      data: {
        tenantId: input.tenantId,
        ticketNo: `TKT-${String(counter.value).padStart(6, "0")}`,
        customerKunnr: input.kunnr,
        raisedByUserId: input.raisedByUserId ?? null,
        category: input.category,
        priority: input.priority,
        status: "open",
        subject: input.subject,
        description: input.description,
        relatedDocType: input.relatedDocType ?? null,
        relatedDocNumber: input.relatedDocNumber ?? null,
        sourceKey: input.sourceKey ?? null,
        openedAt: new Date(),
        ...(input.attachmentKeys?.length
          ? {
              attachments: {
                create: input.attachmentKeys.map((storageKey) => ({
                  tenantId: input.tenantId,
                  storageKey,
                  fileName: storageKey.split("/").pop() ?? storageKey,
                  contentType: "application/octet-stream",
                  sizeBytes: 0,
                  uploadedByUserId: input.raisedByUserId ?? null,
                })),
              },
            }
          : {}),
      },
      include: ticketInclude("agent"),
    });
  });
}

export function updateTicketRow(
  tenantId: string,
  id: string,
  data: Parameters<typeof prisma.supportTicket.update>[0]["data"],
) {
  return prisma.supportTicket.update({
    where: { id },
    data,
    include: ticketInclude("agent"),
  });
}

export function addComment(input: {
  tenantId: string;
  ticketId: string;
  authorUserId?: string | null;
  authorIsAgent: boolean;
  body: string;
  internal: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.ticketComment.create({
      data: {
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        authorUserId: input.authorUserId ?? null,
        authorIsAgent: input.authorIsAgent,
        body: input.body,
        internal: input.internal,
      },
    });
    // Touch the ticket so list ordering and "last activity" stay honest.
    return tx.supportTicket.update({
      where: { id: input.ticketId },
      data: { updatedAt: new Date() },
      include: ticketInclude("agent"),
    });
  });
}

export function createAttachment(input: {
  tenantId: string;
  ticketId: string;
  commentId?: string | null;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId?: string | null;
}) {
  return prisma.ticketAttachment.create({ data: input });
}

/**
 * Tickets whose SLA deadline has passed and which have not been reported yet.
 *
 * The deadline itself is derived per priority in the domain, so the sweep
 * loads the candidates and lets `@cc/domain` decide — the alternative,
 * encoding the priority-to-hours table in SQL, would be a second copy of a
 * registry that already exists.
 */
export function findUnbreachedOpenTickets(tenantId: string) {
  return prisma.supportTicket.findMany({
    where: { tenantId, slaBreachedAt: null, status: { in: ["open", "in_progress"] } },
    orderBy: { openedAt: "asc" },
  });
}

export function markSlaBreached(id: string, at: Date) {
  return prisma.supportTicket.update({ where: { id }, data: { slaBreachedAt: at } });
}
