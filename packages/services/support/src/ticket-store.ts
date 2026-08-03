import type { Db, Prisma } from "@cc/db";
import { db, runWithTenant } from "@cc/db";
import type {
  SlaView,
  TicketCategory,
  TicketPriority,
  TicketStage,
  TicketStatus,
} from "@cc/domain";
import { buildTicketTimeline, formatTicketNo, slaView } from "@cc/domain";

import { SupportError } from "./errors";

/**
 * Row shapes, mapping and the ticket-number sequence.
 *
 * The mapping layer exists for one reason beyond tidiness: **an internal note
 * must never leave this file for a customer**. `TICKET_SELECT` takes a
 * visibility argument and pushes the filter into the `where` of the comment
 * relation, so a customer read cannot return an internal comment even if a
 * screen later forgets to filter — the rows are never loaded (ADR-028).
 */

export type CommentVisibility = "customer" | "agent";

const COMMENT_SELECT = {
  id: true,
  authorUserId: true,
  authorIsAgent: true,
  body: true,
  internal: true,
  createdAt: true,
  attachments: {
    select: {
      id: true,
      storageKey: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      createdAt: true,
    },
  },
} satisfies Prisma.TicketCommentSelect;

export function ticketSelect(visibility: CommentVisibility) {
  return {
    id: true,
    ticketNo: true,
    customerKunnr: true,
    raisedByUserId: true,
    category: true,
    priority: true,
    status: true,
    subject: true,
    description: true,
    relatedDocType: true,
    relatedDocNumber: true,
    assigneeUserId: true,
    resolution: true,
    openedAt: true,
    startedAt: true,
    resolvedAt: true,
    closedAt: true,
    rating: true,
    ratingComment: true,
    slaBreachedAt: true,
    sourceKey: true,
    createdAt: true,
    updatedAt: true,
    comments: {
      // The control, not a convenience: internal notes are excluded in the
      // query for a customer read, so they are never in memory to leak.
      where: visibility === "customer" ? { internal: false } : {},
      orderBy: { createdAt: "asc" as const },
      select: COMMENT_SELECT,
    },
    attachments: {
      // Files attached at raise time (no comment); a comment's files come
      // back nested under the comment itself.
      where: { commentId: null },
      select: {
        id: true,
        storageKey: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
      },
    },
  } satisfies Prisma.SupportTicketSelect;
}

/** The list needs neither the thread nor the description. */
export const TICKET_LIST_SELECT = {
  id: true,
  ticketNo: true,
  customerKunnr: true,
  category: true,
  priority: true,
  status: true,
  subject: true,
  relatedDocType: true,
  relatedDocNumber: true,
  assigneeUserId: true,
  openedAt: true,
  startedAt: true,
  resolvedAt: true,
  closedAt: true,
  rating: true,
  slaBreachedAt: true,
  updatedAt: true,
} satisfies Prisma.SupportTicketSelect;

type TicketRow = Prisma.SupportTicketGetPayload<{ select: ReturnType<typeof ticketSelect> }>;
type TicketListRow = Prisma.SupportTicketGetPayload<{ select: typeof TICKET_LIST_SELECT }>;
type CommentRow = Prisma.TicketCommentGetPayload<{ select: typeof COMMENT_SELECT }>;

export interface AttachmentRecord {
  id: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface TicketCommentRecord {
  id: string;
  authorUserId: string | null;
  authorIsAgent: boolean;
  body: string;
  internal: boolean;
  createdAt: Date;
  attachments: AttachmentRecord[];
}

export interface TicketSummary {
  id: string;
  ticketNo: string;
  customerKunnr: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  relatedDocType: "order" | "delivery" | "invoice" | null;
  relatedDocNumber: string | null;
  assigneeUserId: string | null;
  openedAt: Date;
  startedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  rating: number | null;
  /** When the SLA breach event was emitted for the current openedAt window. */
  slaBreachedAt: Date | null;
  /** Derived on every read from openedAt + priority — never stored. */
  sla: SlaView;
  updatedAt: Date;
}

export interface TicketRecord extends TicketSummary {
  raisedByUserId: string | null;
  description: string;
  resolution: string | null;
  ratingComment: string | null;
  /** The status timeline, built in @cc/domain and merely rendered. */
  timeline: TicketStage[];
  comments: TicketCommentRecord[];
  /** Files attached when the ticket was raised. */
  attachments: AttachmentRecord[];
}

function toComment(row: CommentRow): TicketCommentRecord {
  return {
    id: row.id,
    authorUserId: row.authorUserId,
    authorIsAgent: row.authorIsAgent,
    body: row.body,
    internal: row.internal,
    createdAt: row.createdAt,
    attachments: row.attachments,
  };
}

export function toSummary(row: TicketListRow, now: Date = new Date()): TicketSummary {
  return {
    id: row.id,
    ticketNo: row.ticketNo,
    customerKunnr: row.customerKunnr,
    category: row.category,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    relatedDocType: row.relatedDocType,
    relatedDocNumber: row.relatedDocNumber,
    assigneeUserId: row.assigneeUserId,
    openedAt: row.openedAt,
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    rating: row.rating,
    slaBreachedAt: row.slaBreachedAt,
    sla: slaView(row.openedAt, row.priority, { resolvedAt: row.resolvedAt, now }),
    updatedAt: row.updatedAt,
  };
}

export function toRecord(row: TicketRow, now: Date = new Date()): TicketRecord {
  return {
    ...toSummary(row, now),
    raisedByUserId: row.raisedByUserId,
    description: row.description,
    resolution: row.resolution,
    ratingComment: row.ratingComment,
    timeline: buildTicketTimeline(row),
    comments: row.comments.map(toComment),
    attachments: row.attachments,
  };
}

/**
 * Reads one ticket and enforces the boundary.
 *
 * `kunnr` is undefined for a back-office read, which is the *only* way to
 * skip the account check — and callers reach that path through
 * `requireAgent`, never by passing undefined from a request. A customer whose
 * account doesn't match gets `not_found`, identical to a ticket that never
 * existed (CLAUDE.md rule 5).
 */
export async function readOwnedTicket(
  tenantId: string,
  ticketId: string,
  options: { kunnr?: string; visibility: CommentVisibility },
): Promise<TicketRecord> {
  const row = await runWithTenant(tenantId, () =>
    db.supportTicket.findUnique({
      where: { id: ticketId },
      select: ticketSelect(options.visibility),
    }),
  );

  if (!row) throw new SupportError("not_found");
  if (options.kunnr !== undefined && row.customerKunnr !== options.kunnr) {
    throw new SupportError("not_found");
  }

  return toRecord(row as TicketRow);
}

/**
 * Allocates the next per-tenant ticket number.
 *
 * Runs inside the caller's transaction, so a ticket and its number are one
 * commit — a number handed out by a transaction that then rolls back would
 * leave a permanent gap in a sequence customers read off their screens.
 *
 * The `update` takes a row lock, which serialises every allocation after the
 * first. The one racy moment is the tenant's very first ticket, where two
 * concurrent inserts can collide on the primary key; the caller retries, and
 * the second attempt finds the row and takes the lock like everyone else.
 */
/**
 * Typed structurally rather than as Prisma's `TransactionClient`, for the
 * reason `@cc/db`'s `OutboxWriter` gives: the extended client's transaction
 * type is not assignable to the generated one, and all this needs is the one
 * delegate it touches.
 */
export type TicketCounterWriter = Pick<Db, "ticketCounter">;

export async function nextTicketNo(tx: TicketCounterWriter, tenantId: string): Promise<string> {
  const counter = await tx.ticketCounter.upsert({
    where: { tenantId },
    create: { tenantId, value: 1 },
    update: { value: { increment: 1 } },
  });
  return formatTicketNo(counter.value);
}

/**
 * A Postgres unique-constraint violation, as Prisma reports it. Typed
 * structurally rather than by importing Prisma's error class, which would
 * pull the generated client's namespace in just to name an error code.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}
