import type { NotificationSender, SendResult } from "@cc/adapter-notifications";
import { db, runWithTenant } from "@cc/db";
import type {
  DomainEventName,
  DomainEventPayload,
  NotificationSeverity,
  RenderedNotification,
} from "@cc/domain";
import { notificationKunnr, renderNotifications } from "@cc/domain";

import { getNotificationSender, portalUrl } from "./adapters";
import { resolveRecipients, type NotificationRecipientRow } from "./recipients";

/**
 * Turning one domain event into notifications (docs/07 A7).
 *
 * Called by the worker handler in `@cc/workers`, once per relayed event. The
 * shape mirrors A3's auto-ticket: the *routing* is the worker's business and
 * the *work* is the module's, so everything below — rendering, recipient
 * resolution, the inbox rows, the email mirror — lives here and the handler
 * is four lines.
 *
 * Order matters, and it is the same order ADR-026 chose for a POD: **the
 * durable thing first**. The inbox rows are written before a single mail is
 * attempted, because the bell is the portal's own record of what it told
 * somebody, and a provider outage must not leave a notification that was
 * emailed but is nowhere in the portal. Emails are attempted afterwards,
 * one recipient at a time, and a failure is recorded on the row rather than
 * thrown: the fact already happened, the customer can already see it, and
 * failing the job here would re-run the fan-out for the sake of a mail.
 */

export interface FanOutOptions {
  /** Injectable for tests; defaults to the env-resolved platform sender. */
  sender?: NotificationSender;
  /** Skips the email mirror entirely (the integration suite uses this). */
  skipOutbound?: boolean;
  now?: () => Date;
}

export interface FanOutResult {
  /** Inbox rows actually written — zero on a redelivery, by construction. */
  created: number;
  /** Recipients the templates resolved to, whether or not a row was new. */
  recipients: number;
  emailsSent: number;
  emailsFailed: number;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
}

/**
 * Delivers every template registered for one event.
 *
 * `eventId` is the outbox row id — the relay's job id — and it is what makes
 * this idempotent: `(tenantId, userId, eventId, templateKey)` is unique, so a
 * redelivered job writes nothing and sends nothing. That is ADR-023's
 * required-idempotent handler satisfied structurally rather than by a flag
 * somebody has to remember to check.
 */
export async function deliverEventNotifications<N extends DomainEventName>(
  tenantId: string,
  eventId: string,
  eventName: N,
  payload: DomainEventPayload<N>,
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const rendered = renderNotifications(eventName, payload);
  const result: FanOutResult = { created: 0, recipients: 0, emailsSent: 0, emailsFailed: 0 };
  if (rendered.length === 0) return result;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true },
  });
  // A tenant deleted between the event and its relay is not an error worth
  // failing a job over; there is nobody left to tell.
  if (!tenant) return result;

  const kunnr = notificationKunnr(payload);
  const occurredAt = occurredAtOf(payload, options.now?.() ?? new Date());

  for (const template of rendered) {
    const recipients = await resolveRecipients({
      tenantId,
      audience: template.audience,
      permission: template.permission,
      kunnr,
    });
    result.recipients += recipients.length;
    if (recipients.length === 0) continue;

    const written = await writeInboxRows({
      tenantId,
      eventId,
      template,
      recipients,
      kunnr,
      occurredAt,
    });
    result.created += written;

    if (options.skipOutbound || !template.channels.includes("email")) continue;

    const sender = options.sender ?? getNotificationSender();
    for (const recipient of recipients) {
      const outcome = await mirrorByEmail({
        sender,
        tenant,
        recipient,
        template,
        eventId,
      });
      if (outcome === "sent") result.emailsSent += 1;
      if (outcome === "failed") result.emailsFailed += 1;
    }
  }

  return result;
}

async function writeInboxRows(input: {
  tenantId: string;
  eventId: string;
  template: RenderedNotification;
  recipients: NotificationRecipientRow[];
  kunnr?: string;
  occurredAt: Date;
}): Promise<number> {
  const { template } = input;

  const created = await runWithTenant(input.tenantId, () =>
    db.notification.createMany({
      // `skipDuplicates` rather than a catch, for the reason `writeOutboxEvent`
      // gives: a redelivery must be a no-op, not a failed job.
      skipDuplicates: true,
      data: input.recipients.map((recipient) => ({
        tenantId: input.tenantId,
        userId: recipient.id,
        // Null for a back-office row: it is about the tenant's work, not
        // about the recipient's own account, and stamping the customer's
        // KUNNR on it would make it disappear when an agent who also buys
        // switches accounts.
        customerKunnr: template.audience === "customer" ? (input.kunnr ?? null) : null,
        eventName: template.eventName,
        templateKey: template.templateKey,
        eventId: input.eventId,
        severity: template.severity as NotificationSeverity,
        title: template.title,
        body: template.body,
        href: template.href,
        occurredAt: input.occurredAt,
      })),
    }),
  );

  return created.count;
}

async function mirrorByEmail(input: {
  sender: NotificationSender;
  tenant: TenantRow;
  recipient: NotificationRecipientRow;
  template: RenderedNotification;
  eventId: string;
}): Promise<"sent" | "failed" | "skipped"> {
  const { sender, tenant, recipient, template, eventId } = input;

  // A row that already carries a send time is a redelivery whose mail went
  // out the first time. Checking the row rather than trusting the provider's
  // idempotency key is the second of ADR-021's "three places", applied to a
  // different external system.
  const row = await runWithTenant(tenant.id, () =>
    db.notification.findFirst({
      where: {
        userId: recipient.id,
        eventId,
        templateKey: template.templateKey,
      },
      select: { id: true, emailSentAt: true },
    }),
  );
  if (!row || row.emailSentAt) return "skipped";

  let outcome: SendResult;
  try {
    outcome = await sender.send({
      channel: "email",
      tenantId: tenant.id,
      tenantName: tenant.name,
      recipient: { userId: recipient.id, email: recipient.email },
      subject: template.title,
      body: template.body,
      url: portalUrl(tenant.slug, template.href),
      severity: template.severity,
      idempotencyKey: `${eventId}:${recipient.id}:${template.templateKey}`,
    });
  } catch (error) {
    // The contract says a driver never throws for a delivery failure, so
    // this is a misconfiguration or a bug — still not a reason to lose the
    // notification the customer can already see in their bell.
    outcome = { delivered: false, error: error instanceof Error ? error.message : String(error) };
  }

  await runWithTenant(tenant.id, () =>
    db.notification.update({
      where: { id: row.id },
      data: outcome.delivered
        ? { emailSentAt: new Date(), emailError: null }
        : { emailError: (outcome.error ?? "Delivery failed").slice(0, 500) },
    }),
  );

  return outcome.delivered ? "sent" : "failed";
}

/**
 * The moment the fact happened, not the moment the worker saw it.
 *
 * Every event payload carries `occurredAt` (the event registry's base
 * schema), and the bell orders by it — otherwise a queue backlog would
 * reorder a customer's notifications on the way out of it, and a
 * three-hour-old dispatch would sit above the order it belongs to.
 */
function occurredAtOf(payload: unknown, fallback: Date): Date {
  if (typeof payload === "object" && payload !== null) {
    const value = (payload as { occurredAt?: unknown }).occurredAt;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return fallback;
}
