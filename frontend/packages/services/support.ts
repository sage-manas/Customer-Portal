/**
 * Frontend-only stand-in for `@cc/service-support` (customer tickets and the
 * back-office ticket workbench).
 *
 * Tickets are entirely portal-owned — no SAP read anywhere in this module —
 * so the demo store carries the whole module. Raising, commenting,
 * assigning, resolving and rating all work within a server session; SLA is
 * derived on every read by `@cc/domain`, never stored, exactly as in /client.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-support (Prisma `Ticket`/`TicketComment`
 * tables, attachment storage, SLA breach sweep, notification fan-out).
 */

import {
  buildTicketTimeline,
  canTransitionTicket,
  formatTicketNo,
  isTicketClosedState,
  slaView,
  type SlaView,
  type TicketCategory,
  type TicketPriority,
  type TicketStage,
  type TicketStatus,
} from "@cc/domain";

import { DemoServiceError, demoStore, nextSequence, requireDemoKunnr } from "./_demo";

/** A file attached to a ticket or a comment. Portal-owned, like the ticket. */
export interface AttachmentRecord {
  id: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export class SupportError extends DemoServiceError {
  constructor(message: string, code = "support_error", status = 400) {
    super(message, { code, status });
    this.name = "SupportError";
  }
}

export function isSupportError(error: unknown): error is SupportError {
  return error instanceof SupportError;
}

export type SupportErrorCode = string;
export type SupportIssue = { path: string; message: string };
export type CommentVisibility = "customer" | "agent";

export interface SupportContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

export interface AgentContext {
  tenantId: string;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

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
  slaBreachedAt: Date | null;
  sla: SlaView;
  updatedAt: Date;
}

export interface TicketRecord extends TicketSummary {
  raisedByUserId: string | null;
  description: string;
  resolution: string | null;
  ratingComment: string | null;
  timeline: TicketStage[];
  comments: TicketCommentRecord[];
  attachments: AttachmentRecord[];
}

/** What the store actually holds; `sla` and `timeline` are derived per read. */
type StoredTicket = Omit<TicketRecord, "sla" | "timeline">;

const tickets = () => demoStore().tickets as StoredTicket[];

/** SLA and the status timeline are derived on every read, never stored. */
function hydrate(ticket: StoredTicket): TicketRecord {
  return {
    ...ticket,
    sla: slaView(ticket.openedAt, ticket.priority, { resolvedAt: ticket.resolvedAt }),
    timeline: buildTicketTimeline(ticket),
  };
}

/** The list shape: everything on the record except its body and thread. */
function summarize(ticket: StoredTicket): TicketSummary {
  const {
    comments: _comments,
    attachments: _attachments,
    description: _description,
    resolution: _resolution,
    ratingComment: _ratingComment,
    raisedByUserId: _raisedByUserId,
    ...rest
  } = hydrate(ticket);
  return rest;
}

// ---------------------------------------------------------------------------
// Customer plane
// ---------------------------------------------------------------------------

export type TicketListFilter = "all" | "open" | "resolved" | "closed";

export interface TicketListResult {
  tickets: TicketSummary[];
  total: number;
  counts: Record<TicketListFilter, number>;
}

function matches(ticket: StoredTicket, filter: TicketListFilter): boolean {
  switch (filter) {
    case "open":
      return !isTicketClosedState(ticket.status);
    case "resolved":
      return ticket.status === "resolved";
    case "closed":
      return ticket.status === "closed";
    default:
      return true;
  }
}

export async function listTickets(
  context: SupportContext,
  options: {
    filter?: TicketListFilter;
    category?: TicketCategory;
    limit?: number;
    offset?: number;
  } = {},
): Promise<TicketListResult> {
  const account = requireDemoKunnr(context.kunnr);
  const mine = tickets().filter((ticket) => ticket.customerKunnr === account);

  let rows = mine.filter((ticket) => matches(ticket, options.filter ?? "all"));
  if (options.category) rows = rows.filter((ticket) => ticket.category === options.category);

  rows = rows.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const total = rows.length;
  const offset = options.offset ?? 0;
  if (options.limit !== undefined) rows = rows.slice(offset, offset + options.limit);

  return {
    tickets: rows.map(summarize),
    total,
    counts: {
      all: mine.length,
      open: mine.filter((t) => matches(t, "open")).length,
      resolved: mine.filter((t) => matches(t, "resolved")).length,
      closed: mine.filter((t) => matches(t, "closed")).length,
    },
  };
}

export async function getTicket(context: SupportContext, id: string): Promise<TicketRecord> {
  const account = requireDemoKunnr(context.kunnr);
  const ticket = tickets().find((row) => row.id === id && row.customerKunnr === account);
  if (!ticket) throw notFoundTicket();

  const record = hydrate(ticket);
  // A customer never sees internal agent notes.
  return { ...record, comments: record.comments.filter((comment) => !comment.internal) };
}

export async function readOwnedTicket(context: SupportContext, id: string): Promise<TicketRecord> {
  return getTicket(context, id);
}

export interface InsertTicketInput {
  tenantId: string;
  kunnr: string;
  raisedByUserId?: string;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  relatedDocType?: "order" | "delivery" | "invoice";
  relatedDocNumber?: string;
  attachmentKeys?: string[];
  sourceKey?: string;
}

export async function insertTicket(input: InsertTicketInput): Promise<TicketRecord> {
  const sequence = nextSequence("ticket");
  const stored: StoredTicket = {
    id: `ticket-${sequence}`,
    ticketNo: formatTicketNo(sequence),
    customerKunnr: input.kunnr,
    category: input.category,
    priority: input.priority,
    status: "open",
    subject: input.subject,
    description: input.description,
    relatedDocType: input.relatedDocType ?? null,
    relatedDocNumber: input.relatedDocNumber ?? null,
    assigneeUserId: null,
    raisedByUserId: input.raisedByUserId ?? null,
    openedAt: new Date(),
    startedAt: null,
    resolvedAt: null,
    closedAt: null,
    resolution: null,
    rating: null,
    ratingComment: null,
    slaBreachedAt: null,
    comments: [],
    attachments: [],
    updatedAt: new Date(),
  };

  tickets().push(stored);
  return hydrate(stored);
}

export async function createTicket(
  context: SupportContext,
  input: Omit<InsertTicketInput, "tenantId" | "kunnr" | "raisedByUserId">,
  _validateRelatedDoc?: RelatedDocValidator,
): Promise<TicketRecord> {
  const account = requireDemoKunnr(context.kunnr);
  return insertTicket({
    ...input,
    tenantId: context.tenantId,
    kunnr: account,
    raisedByUserId: context.userId,
  });
}

export type RelatedDocValidator = (
  docType: "order" | "delivery" | "invoice",
  docNumber: string,
) => Promise<boolean>;

export async function addCustomerComment(
  context: SupportContext,
  id: string,
  body: string,
): Promise<TicketRecord> {
  const account = requireDemoKunnr(context.kunnr);
  const ticket = tickets().find((row) => row.id === id && row.customerKunnr === account);
  if (!ticket) throw notFoundTicket();

  ticket.comments.push({
    id: `comment-${nextSequence("comment")}`,
    authorUserId: context.userId ?? null,
    authorIsAgent: false,
    body,
    internal: false,
    createdAt: new Date(),
    attachments: [],
  });
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export async function transitionTicketAsCustomer(
  context: SupportContext,
  id: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const account = requireDemoKunnr(context.kunnr);
  const ticket = tickets().find((row) => row.id === id && row.customerKunnr === account);
  if (!ticket) throw notFoundTicket();

  // The transition table is the authority on who may make which move; the
  // customer's is closing a resolved ticket (doc 05 §7.8).
  if (!canTransitionTicket(ticket.status, to, "customer")) {
    throw new SupportError("That isn't a move you can make on this ticket.", "invalid_transition", 409);
  }

  ticket.status = to;
  if (to === "closed") ticket.closedAt = new Date();
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export async function rateTicket(
  context: SupportContext,
  id: string,
  input: { rating: number; comment?: string },
): Promise<TicketRecord> {
  const account = requireDemoKunnr(context.kunnr);
  const ticket = tickets().find((row) => row.id === id && row.customerKunnr === account);
  if (!ticket) throw notFoundTicket();
  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new SupportError("You can rate a ticket once it's been resolved.", "not_resolved", 409);
  }

  ticket.rating = input.rating;
  ticket.ratingComment = input.comment ?? null;
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

// ---------------------------------------------------------------------------
// Agent workbench
// ---------------------------------------------------------------------------

export type WorkbenchFilter = "open" | "unassigned" | "mine" | "breached" | "all";

export const WORKBENCH_PRIORITIES = ["critical", "high", "medium", "low"] as const;

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

function matchesWorkbench(
  ticket: StoredTicket,
  filter: WorkbenchFilter,
  userId?: string,
): boolean {
  switch (filter) {
    case "open":
      return !isTicketClosedState(ticket.status);
    case "unassigned":
      return !ticket.assigneeUserId && !isTicketClosedState(ticket.status);
    case "mine":
      return Boolean(userId) && ticket.assigneeUserId === userId;
    case "breached":
      return (
        slaView(ticket.openedAt, ticket.priority, { resolvedAt: ticket.resolvedAt }).state ===
        "breached"
      );
    default:
      return true;
  }
}

export async function listWorkbench(
  context: AgentContext,
  query: WorkbenchQuery = {},
): Promise<WorkbenchResult> {
  const all = tickets();
  let rows = all.filter((ticket) =>
    matchesWorkbench(ticket, query.filter ?? "open", context.userId),
  );
  if (query.category) rows = rows.filter((ticket) => ticket.category === query.category);
  if (query.priority) rows = rows.filter((ticket) => ticket.priority === query.priority);

  const counts = Object.fromEntries(
    (["open", "unassigned", "mine", "breached", "all"] as WorkbenchFilter[]).map((filter) => [
      filter,
      all.filter((ticket) => matchesWorkbench(ticket, filter, context.userId)).length,
    ]),
  ) as Record<WorkbenchFilter, number>;

  return {
    tickets: rows
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
      .map(summarize),
    total: rows.length,
    counts,
  };
}

export async function getTicketForAgent(_context: AgentContext, id: string): Promise<TicketRecord> {
  const ticket = tickets().find((row) => row.id === id);
  if (!ticket) throw notFoundTicket();
  return hydrate(ticket);
}

export async function assignTicket(
  context: AgentContext,
  id: string,
  assigneeUserId: string | null,
): Promise<TicketRecord> {
  const ticket = tickets().find((row) => row.id === id);
  if (!ticket) throw notFoundTicket();
  ticket.assigneeUserId = assigneeUserId;
  if (assigneeUserId && ticket.status === "open") {
    ticket.status = "in_progress";
    ticket.startedAt = new Date();
  }
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export async function addAgentComment(
  context: AgentContext,
  id: string,
  body: string,
  visibility: CommentVisibility = "customer",
): Promise<TicketRecord> {
  const ticket = tickets().find((row) => row.id === id);
  if (!ticket) throw notFoundTicket();

  ticket.comments.push({
    id: `comment-${nextSequence("comment")}`,
    authorUserId: context.userId ?? null,
    authorIsAgent: true,
    body,
    internal: visibility === "agent",
    createdAt: new Date(),
    attachments: [],
  });
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export async function transitionTicketAsAgent(
  context: AgentContext,
  id: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const ticket = tickets().find((row) => row.id === id);
  if (!ticket) throw notFoundTicket();

  ticket.status = to;
  if (to === "in_progress" && !ticket.startedAt) ticket.startedAt = new Date();
  if (to === "closed") ticket.closedAt = new Date();
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export async function resolveTicket(
  context: AgentContext,
  id: string,
  resolution: string,
): Promise<TicketRecord> {
  const ticket = tickets().find((row) => row.id === id);
  if (!ticket) throw notFoundTicket();

  ticket.status = "resolved";
  ticket.resolution = resolution;
  ticket.resolvedAt = new Date();
  ticket.updatedAt = new Date();
  return hydrate(ticket);
}

export function routedRoleFor(_category: TicketCategory): string {
  return "client_admin";
}

// ---------------------------------------------------------------------------
// Attachments, SLA sweep, auto-tickets
// ---------------------------------------------------------------------------

export interface UploadAttachmentInput {
  tenantId: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export interface UploadedAttachment {
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadTicketAttachment(
  input: UploadAttachmentInput,
): Promise<UploadedAttachment> {
  // TODO(BACKEND):
  // The real service streams the file into object storage
  // (@cc/adapter-storage) and returns its key. Demo mode records the
  // metadata so the UI can list the file; there are no bytes behind it.
  return {
    storageKey: attachmentStorageKey(input.tenantId, input.fileName),
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.body.byteLength,
  };
}

export function describeAttachments(attachments: readonly AttachmentRecord[]): string {
  return attachments.map((attachment) => attachment.fileName).join(", ");
}

export function attachmentStorageKey(tenantId: string, fileName: string): string {
  return `${tenantId}/support/${fileName}`;
}

export function getSupportStorage(): null {
  return null;
}

export interface SlaBreach {
  ticketId: string;
  ticketNo: string;
}

export async function sweepSlaBreaches(): Promise<SlaBreach[]> {
  // TODO(BACKEND): runs as a cron job in @cc/workers.
  return [];
}

export interface AutoTicketResult {
  ticket: TicketRecord | null;
  created: boolean;
}

export async function raiseDiscrepancyTicket(): Promise<AutoTicketResult> {
  // TODO(BACKEND): raised by the delivery worker on a POD discrepancy event.
  return { ticket: null, created: false };
}

function notFoundTicket(): SupportError {
  return new SupportError("We couldn't find that ticket.", "not_found", 404);
}
