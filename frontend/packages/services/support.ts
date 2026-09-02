/**
 * `@cc/service-support` — customer tickets and the back-office workbench.
 *
 * The one module the portal owns end to end: there is no SAP read anywhere in
 * it, because while a tenant runs portal-native SAP owns nothing here
 * (ADR-028). Every row lives in Postgres.
 *
 * Two invariants the screens rely on and do not implement:
 *
 *  - **The SLA deadline is derived on every read**, from `openedAt` plus the
 *    priority, by `slaView` in `@cc/domain`. It is never stored, so changing a
 *    tenant's SLA table re-answers every open ticket with nothing to backfill.
 *  - **Internal notes are excluded in the query, not filtered in the screen**
 *    (`support-repository`). The customer and agent planes are separate
 *    functions rather than one function with a flag, so a missing argument
 *    cannot widen a customer read into a tenant-wide one.
 *
 * The transition table in `@cc/domain` is the authority on who may make which
 * move — a customer may close and reopen, never resolve — and it is consulted
 * here rather than re-expressed.
 */

import {
  buildTicketTimeline,
  canTransitionTicket,
  isTicketClosedState,
  slaView,
  TICKET_CATEGORY_DEFS,
  type SlaView,
  type TicketCategory,
  type TicketPriority,
  type TicketStage,
  type TicketStatus,
} from "@cc/domain";

import { AppError, ConflictError, NotFoundError } from "@/server/errors";
import * as repo from "@/server/repositories/support-repository";

export class SupportError extends AppError {
  constructor(message: string, code = "support_error", status = 400) {
    super(message, { code: code as never, status });
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
// Records — the shapes the screens already render
// ---------------------------------------------------------------------------

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

/** The row shape both planes read, before SLA and the timeline are derived. */
type Row = {
  id: string;
  ticketNo: string;
  customerKunnr: string;
  raisedByUserId: string | null;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  subject: string;
  description: string;
  relatedDocType: "order" | "delivery" | "invoice" | null;
  relatedDocNumber: string | null;
  assigneeUserId: string | null;
  resolution: string | null;
  rating: number | null;
  ratingComment: string | null;
  slaBreachedAt: Date | null;
  openedAt: Date;
  startedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
};

type RowWithThread = Row & {
  comments: Array<{
    id: string;
    authorUserId: string | null;
    authorIsAgent: boolean;
    body: string;
    internal: boolean;
    createdAt: Date;
    attachments: AttachmentRecord[];
  }>;
  attachments: AttachmentRecord[];
};

function summarize(row: Row): TicketSummary {
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
    // Derived per read, never stored.
    sla: slaView(row.openedAt, row.priority, { resolvedAt: row.resolvedAt }),
    updatedAt: row.updatedAt,
  };
}

function hydrate(row: RowWithThread): TicketRecord {
  return {
    ...summarize(row),
    raisedByUserId: row.raisedByUserId,
    description: row.description,
    resolution: row.resolution,
    ratingComment: row.ratingComment,
    timeline: buildTicketTimeline(row),
    comments: row.comments.map((comment) => ({
      id: comment.id,
      authorUserId: comment.authorUserId,
      authorIsAgent: comment.authorIsAgent,
      body: comment.body,
      internal: comment.internal,
      createdAt: comment.createdAt,
      attachments: comment.attachments,
    })),
    attachments: row.attachments,
  };
}

function requireAccount(kunnr: string | undefined): string {
  if (!kunnr) {
    throw new SupportError("No customer account is linked to this login.", "no_account", 403);
  }
  return kunnr;
}

function ticketNotFound(): never {
  // 404, never 403: a customer must not learn that another account's ticket
  // number is real.
  throw new NotFoundError("That ticket");
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

/** The filter's status set, so the query does the filtering, not a loop. */
function statusesFor(filter: TicketListFilter): TicketStatus[] | undefined {
  switch (filter) {
    case "open":
      return ["open", "in_progress"];
    case "resolved":
      return ["resolved"];
    case "closed":
      return ["closed"];
    default:
      return undefined;
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
  const kunnr = requireAccount(context.kunnr);
  const filter = options.filter ?? "all";
  const base = { kunnr, category: options.category };

  const [rows, total, all, open, resolved, closed] = await Promise.all([
    repo.listTicketRows(
      context.tenantId,
      { ...base, status: statusesFor(filter) },
      { limit: options.limit, offset: options.offset },
    ),
    repo.countTickets(context.tenantId, { ...base, status: statusesFor(filter) }),
    repo.countTickets(context.tenantId, { kunnr }),
    repo.countTickets(context.tenantId, { kunnr, status: statusesFor("open") }),
    repo.countTickets(context.tenantId, { kunnr, status: statusesFor("resolved") }),
    repo.countTickets(context.tenantId, { kunnr, status: statusesFor("closed") }),
  ]);

  return {
    tickets: (rows as Row[]).map(summarize),
    total,
    counts: { all, open, resolved, closed },
  };
}

export async function getTicket(context: SupportContext, id: string): Promise<TicketRecord> {
  const kunnr = requireAccount(context.kunnr);
  const row = await repo.findTicketForCustomer(context.tenantId, kunnr, id);
  if (!row) ticketNotFound();
  // Internal notes were already excluded by the query.
  return hydrate(row as unknown as RowWithThread);
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
  const row = await repo.createTicketRow({
    tenantId: input.tenantId,
    kunnr: input.kunnr,
    raisedByUserId: input.raisedByUserId ?? null,
    category: input.category,
    priority: input.priority,
    subject: input.subject,
    description: input.description,
    relatedDocType: input.relatedDocType ?? null,
    relatedDocNumber: input.relatedDocNumber ?? null,
    sourceKey: input.sourceKey ?? null,
    attachmentKeys: input.attachmentKeys,
  });
  return hydrate(row as unknown as RowWithThread);
}

export type RelatedDocValidator = (
  docType: "order" | "delivery" | "invoice",
  docNumber: string,
) => Promise<boolean>;

export async function createTicket(
  context: SupportContext,
  input: Omit<InsertTicketInput, "tenantId" | "kunnr" | "raisedByUserId">,
  validateRelatedDoc?: RelatedDocValidator,
): Promise<TicketRecord> {
  const kunnr = requireAccount(context.kunnr);

  // A ticket may name an order, delivery or invoice. The document is SAP's, so
  // the check is a SAP read the caller passes in — the service does not reach
  // for an adapter itself, and a number the customer cannot see is refused
  // rather than silently attached.
  if (validateRelatedDoc && input.relatedDocType && input.relatedDocNumber) {
    const exists = await validateRelatedDoc(input.relatedDocType, input.relatedDocNumber);
    if (!exists) {
      throw new SupportError(
        "We couldn't find that document on your account.",
        "related_doc_not_found",
        400,
      );
    }
  }

  return insertTicket({
    ...input,
    tenantId: context.tenantId,
    kunnr,
    raisedByUserId: context.userId,
  });
}

export async function addCustomerComment(
  context: SupportContext,
  id: string,
  body: string,
): Promise<TicketRecord> {
  const kunnr = requireAccount(context.kunnr);
  const ticket = await repo.findTicketForCustomer(context.tenantId, kunnr, id);
  if (!ticket) ticketNotFound();

  await repo.addComment({
    tenantId: context.tenantId,
    ticketId: ticket.id,
    authorUserId: context.userId ?? null,
    authorIsAgent: false,
    // A customer session may never write an internal note. Not a parameter:
    // there is no argument a caller could pass to make this true.
    internal: false,
    body,
  });

  return getTicket(context, id);
}

export async function transitionTicketAsCustomer(
  context: SupportContext,
  id: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const kunnr = requireAccount(context.kunnr);
  const ticket = await repo.findTicketForCustomer(context.tenantId, kunnr, id);
  if (!ticket) ticketNotFound();

  if (!canTransitionTicket(ticket.status, to, "customer")) {
    throw new ConflictError("That isn't a move you can make on this ticket.");
  }

  await repo.updateTicketRow(context.tenantId, ticket.id, {
    status: to,
    ...(to === "closed" ? { closedAt: new Date() } : {}),
    // A reopen restarts the SLA clock and clears the breach flag: the tenant
    // owes a fresh response, and measuring against the original opening would
    // book every reopened ticket as breached on arrival.
    ...(to === "open" ? { openedAt: new Date(), slaBreachedAt: null, closedAt: null } : {}),
  });

  return getTicket(context, id);
}

export async function rateTicket(
  context: SupportContext,
  id: string,
  input: { rating: number; comment?: string },
): Promise<TicketRecord> {
  const kunnr = requireAccount(context.kunnr);
  const ticket = await repo.findTicketForCustomer(context.tenantId, kunnr, id);
  if (!ticket) ticketNotFound();

  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    throw new ConflictError("You can rate a ticket once it's been resolved.");
  }

  await repo.updateTicketRow(context.tenantId, ticket.id, {
    rating: input.rating,
    ratingComment: input.comment ?? null,
  });

  return getTicket(context, id);
}

// ---------------------------------------------------------------------------
// Agent workbench — a separate plane, deliberately separate functions
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

function workbenchFilters(filter: WorkbenchFilter, userId?: string): repo.TicketFilters {
  switch (filter) {
    case "open":
      return { status: ["open", "in_progress"] };
    case "unassigned":
      return { status: ["open", "in_progress"], unassigned: true };
    case "mine":
      return { assigneeUserId: userId ?? "__none__" };
    case "breached":
      // Breach is a derived answer, so the query narrows to live work and the
      // domain decides. Filtering it in SQL would mean a second copy of the
      // priority-to-hours table.
      return { status: ["open", "in_progress"] };
    default:
      return {};
  }
}

function isBreached(row: Row): boolean {
  return slaView(row.openedAt, row.priority, { resolvedAt: row.resolvedAt }).state === "breached";
}

export async function listWorkbench(
  context: AgentContext,
  query: WorkbenchQuery = {},
): Promise<WorkbenchResult> {
  const filter = query.filter ?? "open";

  const rows = (await repo.listTicketRows(context.tenantId, {
    ...workbenchFilters(filter, context.userId),
    category: query.category,
    priority: query.priority,
  })) as Row[];

  const visible = filter === "breached" ? rows.filter(isBreached) : rows;

  const [all, open, unassigned, mine, liveForBreach] = await Promise.all([
    repo.countTickets(context.tenantId, {}),
    repo.countTickets(context.tenantId, workbenchFilters("open")),
    repo.countTickets(context.tenantId, workbenchFilters("unassigned")),
    repo.countTickets(context.tenantId, workbenchFilters("mine", context.userId)),
    repo.listTicketRows(context.tenantId, workbenchFilters("breached")) as Promise<Row[]>,
  ]);

  return {
    tickets: visible.map(summarize),
    total: visible.length,
    counts: { all, open, unassigned, mine, breached: liveForBreach.filter(isBreached).length },
  };
}

export async function getTicketForAgent(context: AgentContext, id: string): Promise<TicketRecord> {
  const row = await repo.findTicketForAgent(context.tenantId, id);
  if (!row) ticketNotFound();
  return hydrate(row as unknown as RowWithThread);
}

export async function assignTicket(
  context: AgentContext,
  id: string,
  assigneeUserId: string | null,
): Promise<TicketRecord> {
  const ticket = await repo.findTicketForAgent(context.tenantId, id);
  if (!ticket) ticketNotFound();

  await repo.updateTicketRow(context.tenantId, ticket.id, {
    assigneeUserId,
    // Claiming an unstarted ticket starts it — the first response has begun.
    ...(assigneeUserId && ticket.status === "open"
      ? { status: "in_progress" as const, startedAt: new Date() }
      : {}),
  });

  return getTicketForAgent(context, id);
}

export async function addAgentComment(
  context: AgentContext,
  id: string,
  body: string,
  visibility: CommentVisibility = "customer",
): Promise<TicketRecord> {
  const ticket = await repo.findTicketForAgent(context.tenantId, id);
  if (!ticket) ticketNotFound();

  await repo.addComment({
    tenantId: context.tenantId,
    ticketId: ticket.id,
    authorUserId: context.userId ?? null,
    authorIsAgent: true,
    internal: visibility === "agent",
    body,
  });

  return getTicketForAgent(context, id);
}

export async function transitionTicketAsAgent(
  context: AgentContext,
  id: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const ticket = await repo.findTicketForAgent(context.tenantId, id);
  if (!ticket) ticketNotFound();

  if (!canTransitionTicket(ticket.status, to, "agent")) {
    throw new ConflictError("That isn't a move you can make on this ticket.");
  }

  await repo.updateTicketRow(context.tenantId, ticket.id, {
    status: to,
    ...(to === "in_progress" && !ticket.startedAt ? { startedAt: new Date() } : {}),
    ...(to === "closed" ? { closedAt: new Date() } : {}),
    ...(to === "open" ? { openedAt: new Date(), slaBreachedAt: null, closedAt: null } : {}),
  });

  return getTicketForAgent(context, id);
}

export async function resolveTicket(
  context: AgentContext,
  id: string,
  resolution: string,
): Promise<TicketRecord> {
  const ticket = await repo.findTicketForAgent(context.tenantId, id);
  if (!ticket) ticketNotFound();

  await repo.updateTicketRow(context.tenantId, ticket.id, {
    status: "resolved",
    resolution,
    resolvedAt: new Date(),
  });

  return getTicketForAgent(context, id);
}

/** Category → the role its queue routes to. The registry decides, not this. */
export function routedRoleFor(category: TicketCategory): string {
  return TICKET_CATEGORY_DEFS[category].routesTo;
}

// ---------------------------------------------------------------------------
// Attachments
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
  // TODO: OBJECT STORAGE
  // The bytes belong in object storage (S3/Azure Blob), never in Postgres —
  // only the key is a database concern, which is why the schema stores one.
  // Until a storage adapter exists the metadata is recorded so the UI can
  // list the file, and nothing pretends the bytes were kept.
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
  return `${tenantId}/support/${Date.now()}-${fileName}`;
}

export function getSupportStorage(): null {
  return null;
}

// ---------------------------------------------------------------------------
// SLA sweep
// ---------------------------------------------------------------------------

export interface SlaBreach {
  ticketId: string;
  ticketNo: string;
}

/**
 * Marks tickets whose SLA deadline has passed.
 *
 * This is the exception to "write the event in the transaction that caused it"
 * (ADR-029): a deadline passing with nothing happening has no causing
 * transaction, so it has to be swept. `slaBreachedAt` makes the sweep
 * idempotent — a ticket is reported once per `openedAt` window, and a reopen
 * clears it.
 */
export async function sweepSlaBreaches(tenantId: string): Promise<SlaBreach[]> {
  const candidates = (await repo.findUnbreachedOpenTickets(tenantId)) as Row[];
  const now = new Date();
  const breached: SlaBreach[] = [];

  for (const row of candidates) {
    if (slaView(row.openedAt, row.priority, { resolvedAt: row.resolvedAt }).state !== "breached") {
      continue;
    }
    await repo.markSlaBreached(row.id, now);
    breached.push({ ticketId: row.id, ticketNo: row.ticketNo });
  }

  return breached;
}

export interface AutoTicketResult {
  ticket: TicketRecord | null;
  created: boolean;
}

/**
 * Raises the ticket a POD discrepancy owes the customer.
 *
 * `sourceKey` is unique per tenant, so a redelivered event hits the constraint
 * instead of raising a second ticket — which is what makes the handler
 * idempotent, as at-least-once delivery requires (ADR-023).
 */
export async function raiseDiscrepancyTicket(input: {
  tenantId: string;
  kunnr: string;
  deliveryVbeln: string;
  notes?: string | null;
  raisedByUserId?: string | null;
}): Promise<AutoTicketResult> {
  const sourceKey = `pod-discrepancy:${input.deliveryVbeln}`;

  try {
    const ticket = await insertTicket({
      tenantId: input.tenantId,
      kunnr: input.kunnr,
      raisedByUserId: input.raisedByUserId ?? undefined,
      category: "delivery",
      priority: "high",
      subject: `Delivery discrepancy reported on ${input.deliveryVbeln}`,
      description:
        input.notes?.trim() || "The quantities received did not match the quantities dispatched.",
      relatedDocType: "delivery",
      relatedDocNumber: input.deliveryVbeln,
      sourceKey,
    });
    return { ticket, created: true };
  } catch (error) {
    // Unique violation on (tenantId, sourceKey): the ticket already exists,
    // which is success for an at-least-once consumer, not a failure.
    if ((error as { code?: string }).code === "P2002") {
      return { ticket: null, created: false };
    }
    throw error;
  }
}

export { isTicketClosedState };
