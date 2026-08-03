import { CURRENCY, LOCALE } from "@cc/config/constants";

import type { Permission } from "../auth";
import { DOMAIN_EVENTS, type DomainEventName, type DomainEventPayload } from "../events";

/**
 * Notification template registry (docs/07 A7, docs/05 §6.4).
 *
 * The bell inbox, the email and — when a driver for it exists — the WhatsApp
 * mirror all render from here. A template says four things and decides
 * nothing else: **who** should hear about an event (an audience plus the
 * permission that audience must hold), **where** it takes them, **what it
 * says**, and **on which channels**.
 *
 * Two properties are load-bearing.
 *
 * 1. It is keyed by `DomainEventName`, so a notification can only ever
 *    describe something that actually happened and was written to the outbox
 *    inside its causing transaction (ADR-023). There is no "send" verb
 *    anywhere in the portal.
 * 2. **An event with no template is not a notification.** The map is partial
 *    on purpose: `payment.captured` is a retry instruction for a worker and
 *    `delivery.discrepancy.reported` already announces itself as a support
 *    ticket, so neither has a row here. A silent event is the default, and
 *    telling somebody something is the thing that has to be declared.
 *
 * Several templates may claim one event, because one fact is often news to
 * two different people for different reasons — a raised ticket is a receipt
 * for the customer and a queue item for the desk. They are separate rows
 * rather than one row with two audiences so that the copy, the deep link and
 * the channel list can differ, which they always do.
 */

// ---- Channels ------------------------------------------------------------

/**
 * Delivery channels. `inapp` is the bell inbox and is written by the portal
 * itself; everything else goes through `@cc/adapter-notifications`.
 *
 * WhatsApp (docs/05 §6.4 "Email/WhatsApp mirrors") is deliberately absent
 * rather than declared-and-unimplemented: a channel in this list is one a
 * template may ask for, and asking for a channel with no driver would be a
 * template that silently does less than it says. It joins the list with its
 * driver.
 */
export const NOTIFICATION_CHANNELS = ["inapp", "email"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Who a template addresses.
 *
 * This is not cosmetic — it decides how recipients are *resolved*, and the
 * two resolutions have different security properties. `customer` fans out to
 * the users linked to the sold-to account the event names, which is the
 * KUNNR boundary every module already enforces (ADR-032). `back_office` fans
 * out to the tenant's staff holding the permission, and never to a customer.
 * A template that got this wrong would be a cross-account leak, which is why
 * the field is required and has no default.
 */
export type NotificationAudience = "customer" | "back_office";

/**
 * Tone for the bell row. Not a `CanonicalStatus` — a notification is an
 * announcement about a document, not a state of one (docs/05 §6.5 fixes that
 * vocabulary and nothing here may grow it).
 */
export type NotificationSeverity = "info" | "success" | "warning" | "critical";

// ---- Template shape ------------------------------------------------------

export interface NotificationTemplate<N extends DomainEventName = DomainEventName> {
  /** Stable id — the row the inbox stores, so copy can change without churn. */
  key: string;
  audience: NotificationAudience;
  /**
   * What a recipient must hold to receive this. It is deliberately the
   * permission that guards the screen `href` points at: a notification is a
   * link to data, so anyone who may not open the link may not be told about
   * it either. Checked again by the route when they click (docs/05 §4.3).
   */
  permission: Permission;
  channels: readonly NotificationChannel[];
  severity: NotificationSeverity | ((payload: DomainEventPayload<N>) => NotificationSeverity);
  title: (payload: DomainEventPayload<N>) => string;
  body: (payload: DomainEventPayload<N>) => string;
  /** Deep link (docs/05 §6.4 "each deep-links"). Always in-portal, relative. */
  href: (payload: DomainEventPayload<N>) => string;
}

type TemplatesFor<N extends DomainEventName> = readonly NotificationTemplate<N>[];

type TemplateRegistry = {
  [N in DomainEventName]?: TemplatesFor<N>;
};

// ---- Formatting helpers --------------------------------------------------

/**
 * Amounts in notification copy. Kept here rather than imported from `@cc/ui`
 * because a template renders into an email as readily as into the bell, and
 * the domain layer may not import a component (CLAUDE.md rule 1).
 */
function amount(value: number, currency = CURRENCY): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function shortDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

// ---- The registry --------------------------------------------------------

/**
 * `event name -> templates`.
 *
 * docs/05 §6.4 lists the bell's contents as "order confirmed, quote
 * received, delivery dispatched, invoice generated, payment posted, ticket
 * updated, credit released". Five of those seven are here. The two that are
 * not — **delivery dispatched** and **invoice generated** — have no template
 * because they have no event, and they have no event because no transaction
 * in the portal makes them true: SAP posts the goods issue and creates the
 * billing document, and the portal only ever learns about it by reading
 * (ADR-016). Announcing them needs a producer that *discovers* the fact, the
 * shape ADR-029 built for SLA breaches, and that sweep is honest work for a
 * later phase rather than something to fake from a page load. "Credit
 * released" is the same story one module over: the blocked-order release
 * queue is not built (ADR-035), so nothing emits it yet.
 */
export const NOTIFICATION_TEMPLATES: TemplateRegistry = {
  "order.created": [
    {
      key: "order.created.customer",
      audience: "customer",
      permission: "order:view",
      channels: ["inapp", "email"],
      severity: (payload) => (payload.creditBlocked ? "warning" : "success"),
      title: (payload) =>
        payload.creditBlocked
          ? `Order ${payload.documentNumber} is on credit hold`
          : `Order ${payload.documentNumber} confirmed`,
      body: (payload) =>
        payload.creditBlocked
          ? "SAP has created your order and is holding it for a credit review. Nothing is lost — it moves on once the hold is released."
          : "Your order is with SAP and has started processing.",
      href: (payload) => `/orders/${payload.documentNumber}`,
    },
  ],

  "delivery.receipt.confirmed": [
    {
      key: "delivery.receipt.confirmed.customer",
      audience: "customer",
      permission: "delivery:view",
      channels: ["inapp"],
      severity: "success",
      title: (payload) => `Receipt recorded for delivery ${payload.documentNumber}`,
      body: (payload) =>
        `We've posted your proof of delivery to SAP against sales order ${payload.salesOrder}.`,
      href: (payload) => `/deliveries/${payload.documentNumber}`,
    },
  ],

  "inquiry.created": [
    {
      key: "inquiry.created.desk",
      audience: "back_office",
      permission: "quotation:issue",
      channels: ["inapp"],
      severity: "info",
      title: (payload) => `New inquiry ${payload.documentNumber} from ${payload.kunnr}`,
      body: (payload) =>
        `${payload.lineCount} line(s), required by ${shortDate(payload.requiredDeliveryDate)}. The customer is waiting on a quotation.`,
      href: () => "/admin/quotations",
    },
  ],

  "quotation.issued": [
    {
      key: "quotation.issued.customer",
      audience: "customer",
      permission: "quotation:view",
      channels: ["inapp", "email"],
      severity: "info",
      title: (payload) => `Quotation ${payload.documentNumber} is ready`,
      body: (payload) =>
        `${amount(payload.grossValue, payload.currency)}, valid until ${shortDate(payload.validUntil)}.`,
      href: (payload) => `/quotations/${payload.documentNumber}`,
    },
  ],

  "quotation.accepted": [
    {
      key: "quotation.accepted.desk",
      audience: "back_office",
      permission: "quotation:issue",
      channels: ["inapp"],
      severity: "success",
      title: (payload) => `Quotation ${payload.documentNumber} accepted`,
      body: (payload) =>
        `${payload.kunnr} accepted; sales order ${payload.salesOrder} was created.`,
      href: () => "/admin/quotations",
    },
  ],

  "quotation.revision.requested": [
    {
      key: "quotation.revision.requested.desk",
      audience: "back_office",
      permission: "quotation:issue",
      channels: ["inapp"],
      severity: (payload) => (payload.expired ? "warning" : "info"),
      title: (payload) =>
        payload.expired
          ? `Revalidation asked for quotation ${payload.documentNumber}`
          : `Revision asked for quotation ${payload.documentNumber}`,
      body: (payload) => `${payload.kunnr} wrote: ${payload.comment}`,
      href: () => "/admin/quotations",
    },
  ],

  "payment.posted": [
    {
      key: "payment.posted.customer",
      audience: "customer",
      permission: "payment:view",
      channels: ["inapp", "email"],
      severity: "success",
      title: () => "Payment cleared in SAP",
      body: (payload) =>
        `Your open items are settled against FI document ${payload.fiDocumentNumber}. The receipt is on your payment.`,
      href: (payload) => `/payments/${payload.paymentId}`,
    },
  ],

  "credit.increase.requested": [
    {
      key: "credit.increase.requested.desk",
      audience: "back_office",
      permission: "credit:decide-limit",
      channels: ["inapp"],
      severity: "info",
      title: (payload) => `${payload.kunnr} asked for a higher credit limit`,
      body: (payload) =>
        `${amount(payload.requestedLimit)} requested, up from ${amount(payload.currentLimit)}.`,
      href: () => "/admin/credit",
    },
  ],

  "credit.increase.decided": [
    {
      key: "credit.increase.decided.customer",
      audience: "customer",
      permission: "account:view",
      channels: ["inapp", "email"],
      severity: (payload) => (payload.decision === "approved" ? "success" : "info"),
      title: (payload) =>
        payload.decision === "approved"
          ? "Your credit limit request was approved"
          : "Your credit limit request was declined",
      body: (payload) =>
        payload.decision === "approved"
          ? // ADR-035 in the copy, not only in the ADR: the desk recorded a
            // decision, and the limit itself moves in FD32. A customer told
            // otherwise would order against headroom that does not exist.
            `Agreed at ${amount(payload.approvedLimit ?? 0)}. It applies once our credit team updates the limit in SAP.`
          : "Our credit team couldn't agree the increase this time — their note is on the request.",
      href: () => "/account/credit",
    },
  ],

  "support.ticket.created": [
    {
      key: "support.ticket.created.customer",
      audience: "customer",
      permission: "support:view",
      channels: ["inapp", "email"],
      severity: "info",
      title: (payload) => `Ticket ${payload.ticketNo} raised`,
      body: (payload) => `${payload.subject} — we'll come back to you on this.`,
      href: (payload) => `/support/${payload.ticketId}`,
    },
    {
      key: "support.ticket.created.desk",
      audience: "back_office",
      permission: "support:resolve",
      channels: ["inapp"],
      severity: (payload) =>
        payload.priority === "critical" || payload.priority === "high" ? "warning" : "info",
      title: (payload) => `${payload.priority} ticket ${payload.ticketNo} from ${payload.kunnr}`,
      body: (payload) => payload.subject,
      href: (payload) => `/admin/tickets/${payload.ticketId}`,
    },
  ],

  "support.ticket.resolved": [
    {
      key: "support.ticket.resolved.customer",
      audience: "customer",
      permission: "support:view",
      channels: ["inapp", "email"],
      severity: "success",
      title: (payload) => `Ticket ${payload.ticketNo} resolved`,
      body: () =>
        "Have a look at the resolution — you can reopen it within 7 days if it isn't sorted.",
      href: (payload) => `/support/${payload.ticketId}`,
    },
  ],

  "support.sla.breached": [
    {
      key: "support.sla.breached.desk",
      audience: "back_office",
      permission: "support:resolve",
      channels: ["inapp", "email"],
      severity: "critical",
      title: (payload) => `SLA breached on ticket ${payload.ticketNo}`,
      body: (payload) =>
        `${payload.priority} priority for ${payload.kunnr}; the deadline was ${shortDate(payload.deadline)} and it is still open.`,
      href: (payload) => `/admin/tickets/${payload.ticketId}`,
    },
  ],
};

// ---- Rendering -----------------------------------------------------------

/** A template applied to one event's payload — what the service stores/sends. */
export interface RenderedNotification {
  eventName: DomainEventName;
  templateKey: string;
  audience: NotificationAudience;
  permission: Permission;
  channels: readonly NotificationChannel[];
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
}

export function templatesForEvent(name: DomainEventName): readonly NotificationTemplate[] {
  return (NOTIFICATION_TEMPLATES[name] ?? []) as readonly NotificationTemplate[];
}

export function isNotifiableEvent(name: DomainEventName): boolean {
  return templatesForEvent(name).length > 0;
}

/**
 * Renders every template registered for an event.
 *
 * Pure, and deliberately so: the fan-out in `@cc/service-notification` and
 * any test can ask what an event *says* without a database, a mailbox or a
 * clock. Copy that needed a lookup to render would be copy that could fail,
 * and a notification that fails to render is one nobody hears.
 */
export function renderNotifications<N extends DomainEventName>(
  name: N,
  payload: DomainEventPayload<N>,
): RenderedNotification[] {
  if (!DOMAIN_EVENTS[name]) {
    throw new Error(`Unknown domain event "${name}" — add it to DOMAIN_EVENTS in @cc/domain.`);
  }

  return templatesForEvent(name).map((template) => ({
    eventName: name,
    templateKey: template.key,
    audience: template.audience,
    permission: template.permission,
    channels: template.channels,
    severity:
      typeof template.severity === "function" ? template.severity(payload) : template.severity,
    title: template.title(payload),
    body: template.body(payload),
    href: template.href(payload),
  }));
}

/**
 * The sold-to account an event concerns, or undefined when it concerns none.
 *
 * Every event that carries a KUNNR carries it under that name (see the event
 * registry), so this reads it structurally rather than per-event. A
 * `customer`-audience template whose payload has no KUNNR cannot be fanned
 * out — the service refuses rather than guessing, because the guess would be
 * "send it to everybody".
 */
export function notificationKunnr(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as { kunnr?: unknown }).kunnr;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
