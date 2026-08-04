import { z } from "zod";

import type { Role } from "../auth";
import type { CanonicalStatus } from "../status";

/**
 * Service & Support (docs/03 Module 8, docs/05 §7.8).
 *
 * Tickets are the first portal-owned document since payments, and the only
 * one the portal owns *outright* — SAP's QMEL exists, but doc 03 Screen 8.1
 * says a tenant may run either ("creates QM notification (QM01) or portal-
 * native ticket per tenant config"), and A3 is mock-first, so the portal owns
 * the record and QMEL becomes a driver concern in Track C.
 *
 * Everything a ticket's behaviour depends on is a table in this file:
 * which queue a category routes to, how long a priority has before it
 * breaches, which status may follow which, and how long a resolved ticket
 * stays reopenable. None of it may be re-expressed as a `switch` in a
 * service, a worker or a screen (CLAUDE.md rule 3) — an SLA that is eight
 * hours in the service and eight hours in the chip is an SLA that will one
 * day be eight hours in one of them.
 */

// ---- Categories -----------------------------------------------------------

export const TICKET_CATEGORIES = ["delivery", "quality", "billing", "product", "general"] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export interface TicketCategoryDef {
  key: TicketCategory;
  label: string;
  /** QMEL-QMART, the SAP notification type this maps to in Track C. */
  qmart: string;
  /**
   * Back-office role the ticket routes to (docs/03 Module 8 flow: "auto-route
   * by category"). Routing is *which queue sees it first*, not an access
   * control — `support:resolve` is what actually gates the workbench, and a
   * client_admin holds it for every category. Under the five-tier model
   * (doc 09) the tenant back office is three roles rather than five, so
   * routing is coarser than it was: billing goes to the AR desk, everything
   * else to the tenant admin.
   */
  routesTo: Role;
  /** One line for the category picker, so the screen carries no copy. */
  hint: string;
}

export const TICKET_CATEGORY_DEFS: Record<TicketCategory, TicketCategoryDef> = {
  delivery: {
    key: "delivery",
    label: "Delivery",
    qmart: "Q1",
    routesTo: "client_admin",
    hint: "Shipment delays, short or damaged receipts, proof-of-delivery disputes.",
  },
  quality: {
    key: "quality",
    label: "Quality",
    qmart: "Q2",
    routesTo: "client_admin",
    hint: "The goods arrived, but they aren't right.",
  },
  billing: {
    key: "billing",
    label: "Billing",
    qmart: "Q3",
    routesTo: "ar_manager",
    hint: "Invoice amounts, tax, credit notes, statement queries.",
  },
  product: {
    key: "product",
    label: "Product",
    qmart: "Q4",
    routesTo: "client_admin",
    hint: "Specifications, availability, alternatives, pricing questions.",
  },
  general: {
    key: "general",
    label: "General",
    qmart: "Q5",
    routesTo: "client_admin",
    hint: "Anything else.",
  },
};

export const TICKET_CATEGORY_LIST: readonly TicketCategoryDef[] = TICKET_CATEGORIES.map(
  (key) => TICKET_CATEGORY_DEFS[key],
);

export function isTicketCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(value);
}

// ---- Priorities and the SLA clock ----------------------------------------

export const TICKET_PRIORITIES = ["critical", "high", "medium", "low"] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface TicketPriorityDef {
  key: TicketPriority;
  label: string;
  /** QMEL-PRIOK. SAP's priority codes are 1 (very high) to 4 (low). */
  priok: string;
  /**
   * Hours from creation to the resolution deadline (docs/07 A3: "SLA hours
   * per priority — registry, not switch statements"). Business hours are
   * deliberately *not* modelled: a calendar-hour SLA is one a customer can
   * verify from the timestamp on their own screen, and a working-calendar
   * SLA needs a per-tenant holiday table nothing in Phase 0 has. When that
   * table exists this becomes its default, not a thing to rip out.
   */
  slaHours: number;
  /** The hint under the priority picker (docs/05 §7.8 "SLA hint per level"). */
  hint: string;
}

export const TICKET_PRIORITY_DEFS: Record<TicketPriority, TicketPriorityDef> = {
  critical: {
    key: "critical",
    label: "Critical",
    priok: "1",
    slaHours: 4,
    hint: "Production is stopped. Response within 4 hours.",
  },
  high: {
    key: "high",
    label: "High",
    priok: "2",
    slaHours: 8,
    hint: "Blocking, but there's a workaround. Response within 8 hours.",
  },
  medium: {
    key: "medium",
    label: "Medium",
    priok: "3",
    slaHours: 24,
    hint: "Needs attention today or tomorrow. Response within 24 hours.",
  },
  low: {
    key: "low",
    label: "Low",
    priok: "4",
    slaHours: 72,
    hint: "A question or a request with no deadline. Response within 3 days.",
  },
};

export const TICKET_PRIORITY_LIST: readonly TicketPriorityDef[] = TICKET_PRIORITIES.map(
  (key) => TICKET_PRIORITY_DEFS[key],
);

export function isTicketPriority(value: string): value is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(value);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * When this ticket must be resolved by.
 *
 * Derived from `openedAt`, never stored as an independent column, for the
 * reason ADR-016 gives about SAP documents and this file gives about
 * registries: a stored deadline and a registry that later changes disagree
 * forever, and the stored one wins silently. The one thing that *is* stored
 * is the priority the customer chose.
 */
export function slaDeadline(openedAt: Date, priority: TicketPriority): Date {
  return new Date(openedAt.getTime() + TICKET_PRIORITY_DEFS[priority].slaHours * HOUR_MS);
}

/** Docs/05 §7.8: "amber <25% remaining, red breached". */
export type SlaState = "ok" | "warning" | "breached" | "met";

export interface SlaView {
  state: SlaState;
  deadline: Date;
  /** Milliseconds left; negative once breached, zero for a met SLA. */
  remainingMs: number;
  /** Fraction of the window still available, clamped to 0–1. */
  remainingFraction: number;
}

/**
 * The SLA chip, and the only definition of "breached" in the portal.
 *
 * `resolvedAt` is what stops the clock — not `closedAt`, because a ticket the
 * customer never gets round to closing is not a ticket the tenant failed to
 * answer. A ticket resolved after its deadline is still `breached`: the
 * breach happened, and a screen that quietly reported "met" once the work
 * finished would make the SLA report meaningless.
 */
export function slaView(
  openedAt: Date,
  priority: TicketPriority,
  options: { resolvedAt?: Date | null; now?: Date } = {},
): SlaView {
  const deadline = slaDeadline(openedAt, priority);
  const windowMs = deadline.getTime() - openedAt.getTime();
  const against = options.resolvedAt ?? options.now ?? new Date();
  const remainingMs = deadline.getTime() - against.getTime();
  const remainingFraction = windowMs === 0 ? 0 : clamp01(remainingMs / windowMs);

  if (remainingMs < 0) return { state: "breached", deadline, remainingMs, remainingFraction };
  if (options.resolvedAt) return { state: "met", deadline, remainingMs, remainingFraction };
  if (remainingFraction < 0.25)
    return { state: "warning", deadline, remainingMs, remainingFraction };
  return { state: "ok", deadline, remainingMs, remainingFraction };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Whether the SLA breach event is owed for this ticket yet.
 *
 * Separate from `slaView` because the sweep asks a narrower question than a
 * screen does: an already-resolved ticket never owes a *new* breach event,
 * however late it was, since the event exists to chase work that is still
 * outstanding.
 */
export function slaBreachDue(
  ticket: {
    openedAt: Date;
    priority: TicketPriority;
    resolvedAt?: Date | null;
    status: TicketStatus;
  },
  now: Date = new Date(),
): boolean {
  if (ticket.resolvedAt) return false;
  if (isTicketClosedState(ticket.status)) return false;
  return slaDeadline(ticket.openedAt, ticket.priority).getTime() < now.getTime();
}

// ---- Status and its transitions ------------------------------------------

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface TicketStatusDef {
  key: TicketStatus;
  label: string;
  /**
   * The canonical status the badge renders (CLAUDE.md rule 3: UI components
   * take `CanonicalStatus`, never a module's private vocabulary).
   */
  status: CanonicalStatus;
}

export const TICKET_STATUS_DEFS: Record<TicketStatus, TicketStatusDef> = {
  open: { key: "open", label: "Open", status: "Open" },
  in_progress: { key: "in_progress", label: "In Progress", status: "InProcess" },
  resolved: { key: "resolved", label: "Resolved", status: "Resolved" },
  closed: { key: "closed", label: "Closed", status: "Closed" },
};

/** A ticket that needs nobody's attention any more. */
export function isTicketClosedState(status: TicketStatus): boolean {
  return status === "closed";
}

/** Statuses that still count against the tenant's queue (admin default filter). */
export function isTicketOpenState(status: TicketStatus): boolean {
  return status === "open" || status === "in_progress";
}

/**
 * Who may move a ticket where.
 *
 * The `by` field is the reason this is a table and not a state machine drawn
 * in the service: a customer may close their own ticket and may reopen a
 * resolved one, but may not mark it resolved — self-resolution would let the
 * SLA be met by the person the SLA protects.
 */
export type TicketActor = "customer" | "agent";

export interface TicketTransitionDef {
  from: TicketStatus;
  to: TicketStatus;
  by: readonly TicketActor[];
  label: string;
}

export const TICKET_TRANSITIONS: readonly TicketTransitionDef[] = [
  { from: "open", to: "in_progress", by: ["agent"], label: "Start work" },
  { from: "open", to: "resolved", by: ["agent"], label: "Resolve" },
  { from: "in_progress", to: "resolved", by: ["agent"], label: "Resolve" },
  { from: "open", to: "closed", by: ["customer", "agent"], label: "Close" },
  { from: "in_progress", to: "closed", by: ["customer", "agent"], label: "Close" },
  { from: "resolved", to: "closed", by: ["customer", "agent"], label: "Close" },
  { from: "resolved", to: "open", by: ["customer", "agent"], label: "Reopen" },
] as const;

export function ticketTransition(
  from: TicketStatus,
  to: TicketStatus,
  actor: TicketActor,
): TicketTransitionDef | undefined {
  return TICKET_TRANSITIONS.find((t) => t.from === from && t.to === to && t.by.includes(actor));
}

export function canTransitionTicket(
  from: TicketStatus,
  to: TicketStatus,
  actor: TicketActor,
): boolean {
  return ticketTransition(from, to, actor) !== undefined;
}

/** The buttons this actor may draw on a ticket in this state. */
export function availableTicketTransitions(
  from: TicketStatus,
  actor: TicketActor,
): TicketTransitionDef[] {
  return TICKET_TRANSITIONS.filter((t) => t.from === from && t.by.includes(actor));
}

/**
 * Docs/05 §7.8: "Reopen (within 7 days of resolve)".
 *
 * After the window the ticket is closed for good and a new one is the honest
 * answer — reopening a two-month-old ticket restarts an SLA clock against
 * work nobody remembers, and buries the new problem in the old thread.
 */
export const TICKET_REOPEN_WINDOW_DAYS = 7;

export function canReopenTicket(
  ticket: { status: TicketStatus; resolvedAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (ticket.status !== "resolved" || !ticket.resolvedAt) return false;
  const deadline = ticket.resolvedAt.getTime() + TICKET_REOPEN_WINDOW_DAYS * 24 * HOUR_MS;
  return now.getTime() <= deadline;
}

// ---- The status timeline --------------------------------------------------

/**
 * Docs/05 §7.8: "status timeline (Open → In Progress → Resolved → Closed)".
 * Built here for the same reason the O2C spine and the delivery stepper are
 * (ADR-015): the list and detail screens both draw it.
 */
export const TICKET_TIMELINE: readonly TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
] as const;

export interface TicketStage extends TicketStatusDef {
  reached: boolean;
  current: boolean;
  /** When the ticket reached this stage, where the ticket records it. */
  at?: Date;
}

export function buildTicketTimeline(ticket: {
  status: TicketStatus;
  openedAt: Date;
  startedAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
}): TicketStage[] {
  const at: Record<TicketStatus, Date | null | undefined> = {
    open: ticket.openedAt,
    in_progress: ticket.startedAt,
    resolved: ticket.resolvedAt,
    closed: ticket.closedAt,
  };
  const currentIndex = TICKET_TIMELINE.indexOf(ticket.status);

  return TICKET_TIMELINE.map((key, index) => ({
    ...TICKET_STATUS_DEFS[key],
    // A reopened ticket is `open` again, so later stages are *not* reached
    // even though they carry a timestamp from the first pass. The dates stay
    // — they are history — but the stepper shows where the ticket is now.
    reached: index <= currentIndex,
    current: index === currentIndex,
    at: at[key] ?? undefined,
  }));
}

// ---- CSAT -----------------------------------------------------------------

/** Docs/05 §7.8: "Rate Resolution (1–5 stars + comment)". */
export const TICKET_RATING_MIN = 1;
export const TICKET_RATING_MAX = 5;

/**
 * A rating is a judgement of the resolution, so there has to be one: rating an
 * open ticket rates work that hasn't happened.
 */
export function canRateTicket(ticket: { status: TicketStatus; rating?: number | null }): boolean {
  if (ticket.rating != null) return false;
  return ticket.status === "resolved" || ticket.status === "closed";
}

// ---- Write schemas --------------------------------------------------------

const subject = z
  .string()
  .trim()
  .min(5, "Give the ticket a subject of at least 5 characters.")
  // QMEL-QMTXT is CHAR 40 (docs/03 Screen 8.1). Enforced now rather than at
  // the QMEL driver, so a portal-native ticket can never hold a subject the
  // tenant's later switch to QM01 would silently truncate.
  .max(40, "Keep the subject to 40 characters — there's room for detail below.");

export const ticketCreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  subject,
  description: z
    .string()
    .trim()
    .min(20, "Describe the problem in at least 20 characters so we can act on it.")
    .max(2000),
  /**
   * Optional link to the document the ticket is about (docs/03 Screen 8.1
   * "Related doc — QMEL sales-doc ref"). A VBELN, and validated as *existing*
   * by the service against SAP, not here: this schema knows shapes, not
   * whether a document is yours.
   */
  relatedDocType: z.enum(["order", "delivery", "invoice"]).optional(),
  relatedDocNumber: z.string().trim().max(20).optional(),
  /** Storage keys of attachments uploaded before submit, as with the POD scan. */
  attachmentKeys: z.array(z.string().max(500)).max(5).default([]),
});

export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

export const ticketCommentSchema = z.object({
  body: z.string().trim().min(1, "Write a comment before posting.").max(2000),
  /**
   * Back-office only. An internal note is invisible to the customer, so the
   * service refuses this flag from a customer session outright rather than
   * trusting the client — see the support service.
   */
  internal: z.boolean().default(false),
  attachmentKeys: z.array(z.string().max(500)).max(5).default([]),
});

export type TicketCommentInput = z.infer<typeof ticketCommentSchema>;

export const ticketResolveSchema = z.object({
  /** QMEL-IDATE's companion: what was actually done. */
  resolution: z
    .string()
    .trim()
    .min(10, "Say what was done to resolve this — the customer sees this text.")
    .max(2000),
});

export type TicketResolveInput = z.infer<typeof ticketResolveSchema>;

export const ticketRatingSchema = z.object({
  rating: z
    .number()
    .int()
    .min(TICKET_RATING_MIN, "Rate the resolution from 1 to 5.")
    .max(TICKET_RATING_MAX, "Rate the resolution from 1 to 5."),
  comment: z.string().trim().max(1000).optional(),
});

export type TicketRatingInput = z.infer<typeof ticketRatingSchema>;

export const ticketTransitionSchema = z.object({
  to: z.enum(TICKET_STATUSES),
});

export const ticketAssignSchema = z.object({
  /** Portal user id of the agent, or null to return the ticket to the queue. */
  assigneeUserId: z.string().min(1).nullable(),
});

// ---- Ticket numbering -----------------------------------------------------

/**
 * Human-facing ticket reference (docs/03 Screen 8.2 "Ticket No.").
 *
 * Per-tenant and sequential, formatted here so the service, the seed and the
 * screens all agree on the shape. It is not the primary key — that stays a
 * cuid — because a customer-visible sequential number leaks how many tickets
 * a tenant handles, and must never be the thing a URL or a lookup trusts.
 */
export function formatTicketNo(sequence: number): string {
  return `TKT-${String(sequence).padStart(6, "0")}`;
}
