import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type {
  TicketCategory,
  TicketCreateInput,
  TicketCommentInput,
  TicketPriority,
  TicketRatingInput,
  TicketStatus,
} from "@cc/domain";
import {
  canRateTicket,
  canReopenTicket,
  canTransitionTicket,
  TICKET_CATEGORY_DEFS,
  ticketCommentSchema,
  ticketCreateSchema,
  ticketRatingSchema,
} from "@cc/domain";

import { describeAttachments } from "./attachment-service";
import { invalidFrom, SupportError } from "./errors";
import {
  isUniqueViolation,
  nextTicketNo,
  readOwnedTicket,
  TICKET_LIST_SELECT,
  toSummary,
  type TicketRecord,
  type TicketSummary,
} from "./ticket-store";

/**
 * Service & Support, customer plane (docs/03 Module 8, docs/05 §7.8).
 *
 * The portal owns tickets outright — there is no SAP document to defer to
 * while a tenant runs portal-native (ADR-028) — so unlike deliveries and
 * invoices this module reads and writes its own tables. What carries over
 * unchanged is the boundary: **the sold-to account is the security
 * boundary**, every entry point takes the session's KUNNR, and a mismatch is
 * a 404 rather than a 403 (CLAUDE.md rule 5).
 *
 * A ticket belongs to the *account*, not to the person who raised it — a
 * colleague on the same KUNNR sees it and may comment. That mirrors the cart
 * (ADR-014) and payments, and it is what a buying organisation expects: the
 * person who raised the query goes on holiday, the problem does not.
 */

export interface SupportContext {
  tenantId: string;
  kunnr: string | undefined;
  userId?: string;
}

function requireAccount(context: SupportContext): string {
  if (!context.kunnr) throw new SupportError("no_account");
  return context.kunnr;
}

// ---- Reads ----------------------------------------------------------------

export type TicketListFilter = "all" | "open" | "resolved" | "closed";

export interface TicketListResult {
  tickets: TicketSummary[];
  total: number;
  /** Counts per filter, so the tabs can show them without a second call. */
  counts: Record<TicketListFilter, number>;
}

const FILTER_STATUSES: Record<TicketListFilter, TicketStatus[] | null> = {
  all: null,
  open: ["open", "in_progress"],
  resolved: ["resolved"],
  closed: ["closed"],
};

/**
 * The customer's ticket list (docs/05 §7.8 "Track").
 *
 * Sorted newest-activity-first rather than by SLA: a customer is not managing
 * a queue, they are checking on the thing they last spoke to somebody about.
 * The workbench sorts by SLA, and does so for the opposite reason.
 */
export async function listTickets(
  context: SupportContext,
  options: { filter?: TicketListFilter } = {},
): Promise<TicketListResult> {
  const account = requireAccount(context);
  const filter = options.filter ?? "all";
  const statuses = FILTER_STATUSES[filter];

  const [rows, grouped] = await runWithTenant(context.tenantId, () =>
    Promise.all([
      db.supportTicket.findMany({
        where: {
          customerKunnr: account,
          ...(statuses ? { status: { in: statuses } } : {}),
        },
        orderBy: { updatedAt: "desc" },
        select: TICKET_LIST_SELECT,
      }),
      db.supportTicket.groupBy({
        by: ["status"],
        where: { customerKunnr: account },
        _count: { _all: true },
      }),
    ]),
  );

  const now = new Date();
  return {
    tickets: rows.map((row) => toSummary(row, now)),
    total: rows.length,
    counts: countsByFilter(grouped),
  };
}

function countsByFilter(
  grouped: ReadonlyArray<{ status: TicketStatus; _count: { _all: number } }>,
): Record<TicketListFilter, number> {
  const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
  const of = (status: TicketStatus) => byStatus.get(status) ?? 0;
  return {
    all: grouped.reduce((sum, row) => sum + row._count._all, 0),
    open: of("open") + of("in_progress"),
    resolved: of("resolved"),
    closed: of("closed"),
  };
}

export async function getTicket(context: SupportContext, ticketId: string): Promise<TicketRecord> {
  const account = requireAccount(context);
  return readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });
}

// ---- Raise ----------------------------------------------------------------

/**
 * Checks that a referenced document exists and belongs to this customer.
 *
 * Passed in rather than resolved here, for the same reason the delivery
 * module takes its `SapAdapter` as a parameter: the document lives in SAP,
 * `@cc/service-sap` is what resolves the adapter, and a service may not
 * import another service (ADR-011). The route handler sequences it.
 */
export type RelatedDocValidator = (
  docType: "order" | "delivery" | "invoice",
  docNumber: string,
) => Promise<boolean>;

export interface CreateTicketResult {
  ticket: TicketRecord;
}

export async function createTicket(
  context: SupportContext,
  input: TicketCreateInput,
  options: { validateRelatedDoc?: RelatedDocValidator } = {},
): Promise<TicketRecord> {
  const account = requireAccount(context);

  const parsed = ticketCreateSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);
  const data = parsed.data;

  if (data.relatedDocType && !data.relatedDocNumber) {
    throw new SupportError("invalid", {
      issues: [{ field: "relatedDocNumber", message: "Enter the document number." }],
    });
  }

  // A reference to a document that isn't this customer's is refused rather
  // than stored and quietly ignored: the back office would otherwise open a
  // ticket pointing at a document they cannot see, or worse, at one belonging
  // to a different customer entirely.
  if (data.relatedDocType && data.relatedDocNumber && options.validateRelatedDoc) {
    const exists = await options.validateRelatedDoc(data.relatedDocType, data.relatedDocNumber);
    if (!exists) {
      throw new SupportError("invalid", {
        issues: [
          {
            field: "relatedDocNumber",
            message: "We couldn't find that document on your account.",
          },
        ],
      });
    }
  }

  const ticketId = await insertTicket({
    tenantId: context.tenantId,
    kunnr: account,
    raisedByUserId: context.userId,
    category: data.category,
    priority: data.priority,
    subject: data.subject,
    description: data.description,
    relatedDocType: data.relatedDocType,
    relatedDocNumber: data.relatedDocNumber,
    attachmentKeys: data.attachmentKeys,
  });

  return readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });
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
  /** Set only by the auto-raise path; makes a redelivered event a no-op. */
  sourceKey?: string;
}

/**
 * The one place a ticket row is created — shared by the customer form and by
 * the worker that raises tickets from POD discrepancies, so both get the
 * number, the routing and the `support.ticket.created` event on identical
 * terms.
 *
 * The event is written in the same transaction as the ticket (ADR-023): a
 * ticket nobody was told about is a ticket that misses its SLA silently.
 */
export async function insertTicket(input: InsertTicketInput): Promise<string> {
  // Resolved before the transaction: reading object metadata is a network
  // call, and a transaction held open across one is a lock held across one.
  const attachments = await describeAttachments(input.attachmentKeys ?? []);

  const attempt = () =>
    runWithTenant(input.tenantId, () =>
      db.$transaction(async (tx) => {
        const ticketNo = await nextTicketNo(tx, input.tenantId);
        const openedAt = new Date();

        const ticket = await tx.supportTicket.create({
          data: {
            tenantId: input.tenantId,
            ticketNo,
            customerKunnr: input.kunnr,
            raisedByUserId: input.raisedByUserId,
            category: input.category,
            priority: input.priority,
            subject: input.subject,
            description: input.description,
            relatedDocType: input.relatedDocType,
            relatedDocNumber: input.relatedDocNumber,
            sourceKey: input.sourceKey,
            openedAt,
            attachments: {
              create: attachments.map((file) => ({
                tenantId: input.tenantId,
                storageKey: file.storageKey,
                fileName: file.fileName,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes,
                uploadedByUserId: input.raisedByUserId,
              })),
            },
          },
          select: { id: true, ticketNo: true },
        });

        await writeOutboxEvent(tx, {
          name: "support.ticket.created",
          payload: {
            occurredAt: openedAt,
            ticketId: ticket.id,
            ticketNo: ticket.ticketNo,
            kunnr: input.kunnr,
            category: input.category,
            priority: input.priority,
            subject: input.subject,
            raisedByUserId: input.raisedByUserId,
          },
          dedupeKey: `support.ticket.created:${ticket.id}`,
        });

        return ticket.id;
      }),
    );

  try {
    return await attempt();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Two causes, and they need opposite answers. An auto-raised ticket that
    // already exists is the idempotency the handler relies on — the caller
    // asks for it by source key. A collision on the counter row is the
    // first-ticket-per-tenant race, which retrying resolves.
    if (input.sourceKey) {
      const existing = await runWithTenant(input.tenantId, () =>
        db.supportTicket.findFirst({
          where: { sourceKey: input.sourceKey },
          select: { id: true },
        }),
      );
      if (existing) return existing.id;
    }
    return attempt();
  }
}

// ---- Thread ---------------------------------------------------------------

/**
 * Adds a comment as the customer.
 *
 * `internal` is refused outright rather than silently dropped: a customer
 * session asking for an internal note is either a bug or a probe, and
 * quietly writing it as visible would put the customer's words in the place
 * the back office keeps its own (ADR-028).
 */
export async function addCustomerComment(
  context: SupportContext,
  ticketId: string,
  input: TicketCommentInput,
): Promise<TicketRecord> {
  const account = requireAccount(context);

  const parsed = ticketCommentSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);
  if (parsed.data.internal) {
    throw new SupportError("invalid", {
      issues: [{ field: "internal", message: "Comments you post are visible to the team." }],
    });
  }

  const ticket = await readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });

  // A closed ticket is a finished conversation. Reopen it, or raise a new
  // one — a comment on a closed ticket reaches nobody's queue, which is the
  // worst of the available outcomes.
  if (ticket.status === "closed") {
    throw new SupportError("not_allowed", {
      message: "This ticket is closed. Reopen it or raise a new one to add to the conversation.",
    });
  }

  const attachments = await describeAttachments(parsed.data.attachmentKeys);

  await runWithTenant(context.tenantId, () =>
    db.ticketComment.create({
      data: {
        tenantId: context.tenantId,
        ticketId,
        authorUserId: context.userId,
        authorIsAgent: false,
        body: parsed.data.body,
        internal: false,
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

  // Touch the ticket so the list's newest-activity-first sort reflects the
  // comment. `updatedAt` is @updatedAt, so an empty update is enough.
  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({ where: { id: ticketId }, data: {} }),
  );

  return readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });
}

// ---- Customer transitions -------------------------------------------------

/**
 * Close or reopen, as the customer.
 *
 * The permitted moves come from the `TICKET_TRANSITIONS` registry with actor
 * `customer`, which is what stops a customer resolving their own ticket — the
 * check is a table lookup here and in the workbench, so the two planes cannot
 * drift apart.
 */
export async function transitionTicketAsCustomer(
  context: SupportContext,
  ticketId: string,
  to: TicketStatus,
): Promise<TicketRecord> {
  const account = requireAccount(context);
  const ticket = await readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });

  if (!canTransitionTicket(ticket.status, to, "customer")) {
    throw new SupportError("not_allowed");
  }

  if (to === "open" && !canReopenTicket(ticket)) {
    throw new SupportError("not_allowed", {
      message:
        "This ticket was resolved more than 7 days ago and can't be reopened. Raise a new one and reference it.",
    });
  }

  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({
      where: { id: ticketId },
      data:
        to === "open"
          ? {
              status: "open",
              // A reopen restarts the SLA clock and clears the breach flag:
              // the tenant owes a fresh answer to a problem that came back,
              // and measuring against the original opening would book the
              // ticket as breached the moment it reopened.
              openedAt: new Date(),
              startedAt: null,
              resolvedAt: null,
              slaBreachedAt: null,
            }
          : { status: "closed", closedAt: new Date() },
    }),
  );

  return readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });
}

// ---- CSAT -----------------------------------------------------------------

export async function rateTicket(
  context: SupportContext,
  ticketId: string,
  input: TicketRatingInput,
): Promise<TicketRecord> {
  const account = requireAccount(context);

  const parsed = ticketRatingSchema.safeParse(input);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const ticket = await readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });

  if (!canRateTicket(ticket)) {
    throw new SupportError("not_allowed", {
      message:
        ticket.rating == null
          ? "You can rate the resolution once the ticket has been resolved."
          : "You've already rated this ticket.",
    });
  }

  await runWithTenant(context.tenantId, () =>
    db.supportTicket.update({
      where: { id: ticketId },
      data: { rating: parsed.data.rating, ratingComment: parsed.data.comment },
    }),
  );

  return readOwnedTicket(context.tenantId, ticketId, {
    kunnr: account,
    visibility: "customer",
  });
}

// ---- Routing --------------------------------------------------------------

/**
 * Which back-office queue a ticket lands in (docs/03 Module 8 "auto-route by
 * category"). A lookup, not a rule: the table is in `@cc/domain`, and this
 * exists so the workbench and any future assignment worker read it the same
 * way.
 */
export function routedRoleFor(category: TicketCategory) {
  return TICKET_CATEGORY_DEFS[category].routesTo;
}
