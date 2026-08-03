import type { NotificationChannel, NotificationSeverity } from "@cc/domain";

/**
 * Outbound notification channels (docs/07 A7, docs/05 §6.4).
 *
 * Email is an external system, so it gets what SAP, GSTN, storage, the
 * payment gateway and the cache got: an interface, a driver that needs
 * nothing external built first, real drivers behind a factory (CLAUDE.md
 * rule 2). Nothing in the portal composes an SMTP session or a provider
 * payload outside this package.
 *
 * The **in-app bell is deliberately not a channel here.** It is a row in the
 * portal's own database, written in the same transaction as the fan-out, and
 * routing it through a "sender" would make the portal an external system to
 * itself — with a network hop and a failure mode where a notification exists
 * for email but not in the inbox. `@cc/service-notification` writes the row;
 * this adapter carries what leaves the building.
 */

export type NotificationDriverName = "log" | "email";

/** The channels this adapter can actually deliver on. */
export type OutboundChannel = Exclude<NotificationChannel, "inapp">;

export interface NotificationRecipient {
  /** Portal user id — carried for correlation, never rendered. */
  userId: string;
  email: string;
  /** Display name, when the portal knows one. */
  name?: string;
}

export interface NotificationMessage {
  channel: OutboundChannel;
  tenantId: string;
  /** Tenant's own name — the "from" a recipient recognises. */
  tenantName: string;
  recipient: NotificationRecipient;
  subject: string;
  body: string;
  /**
   * Absolute URL to the portal screen this is about. Built by the caller,
   * because only the app knows the tenant's own hostname; the driver just
   * puts it in the message.
   */
  url?: string;
  severity: NotificationSeverity;
  /**
   * Idempotency key, stable for one notification. Providers that support it
   * dedupe on it; drivers that do not still log it, so a duplicate is
   * identifiable after the fact rather than merely suspected.
   */
  idempotencyKey: string;
}

export interface SendResult {
  /** False means "not delivered, worth retrying" — never a thrown error. */
  delivered: boolean;
  /** Provider's own id, when it gave one. */
  providerMessageId?: string;
  /** Why it failed, for the exception tray (docs/07 B4). */
  error?: string;
}

export interface NotificationSender {
  readonly driver: NotificationDriverName;
  /** Channels this driver can serve; a message for any other is refused. */
  readonly channels: readonly OutboundChannel[];
  /**
   * Delivers one message.
   *
   * **Never throws for a delivery failure** — a provider that is down, slow
   * or refusing returns `{ delivered: false, error }`, and the caller decides
   * whether to retry. That is the same fail-open instinct the cache adapter
   * has (ADR-036) applied to a different asymmetry: the bell row is already
   * written and the fact already happened, so a mail server outage must not
   * turn into a failed job that re-runs the whole fan-out. Programming errors
   * — an unsupported channel, a missing configuration — still throw.
   */
  send(message: NotificationMessage): Promise<SendResult>;
}
