/**
 * Frontend-only stand-in for `@cc/service-notification` (the bell inbox).
 *
 * The real fan-out runs in @cc/workers off the outbox; nothing in the
 * frontend writes notifications, so the demo inbox is seeded once per
 * process with a small, representative set and supports the reads and the
 * mark-as-read the bell actually calls.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-notification (Prisma `Notification`
 * table, event fan-out, email adapter).
 */

import { z } from "zod";

import type { NotificationSeverity } from "@cc/domain";

import { demoStore } from "./_demo";

export class NotificationServiceError extends Error {
  readonly status = 400;
  readonly code = "notification_error";
}

export function isNotificationServiceError(error: unknown): error is NotificationServiceError {
  return error instanceof NotificationServiceError;
}

export type NotificationServiceErrorCode = string;
export type NotificationIssue = { path: string; message: string };

export interface NotificationView {
  id: string;
  eventName: string;
  templateKey: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
  customerKunnr: string | null;
  read: boolean;
  readAt: string | null;
  occurredAt: string;
}

export interface InboxContext {
  tenantId: string;
  userId: string;
}

export interface ListNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
}

export interface NotificationInbox {
  notifications: NotificationView[];
  unreadCount: number;
}

/**
 * Seeded once per process. The rows mirror what the worker's templates
 * actually produce (@cc/domain NOTIFICATION_TEMPLATES) so the bell, its
 * severities and its deep links all render truthfully.
 */
function seeded(): NotificationView[] {
  const store = demoStore();
  if (store.notifications.length === 0) {
    store.notifications = [
      {
        id: "notif-1",
        eventName: "order.credit_blocked",
        templateKey: "order.credit_blocked.customer",
        severity: "warning",
        title: "Order 0000004713 is on credit hold",
        body: "Our credit team is reviewing it. We'll let you know as soon as it's released.",
        href: "/orders/0000004713",
        customerKunnr: "0010001001",
        read: false,
        readAt: null,
        occurredAt: "2026-07-24T11:02:00.000Z",
      },
      {
        id: "notif-2",
        eventName: "delivery.dispatched",
        templateKey: "delivery.dispatched.customer",
        severity: "info",
        title: "Delivery 0080001901 has been despatched",
        body: "Your consignment is on its way. Confirm receipt once it arrives.",
        href: "/deliveries/0080001901",
        customerKunnr: "0010001001",
        read: false,
        readAt: null,
        occurredAt: "2026-07-22T06:30:00.000Z",
      },
      {
        id: "notif-3",
        eventName: "invoice.issued",
        templateKey: "invoice.issued.customer",
        severity: "info",
        title: "Invoice 0090002211 is available",
        body: "Your invoice has been raised and is ready to view.",
        href: "/invoices/0090002211",
        customerKunnr: "0010001001",
        read: true,
        readAt: "2026-07-21T09:00:00.000Z",
        occurredAt: "2026-07-20T10:15:00.000Z",
      },
    ] satisfies NotificationView[];
  }
  return store.notifications as NotificationView[];
}

export async function listNotifications(
  _context: InboxContext,
  options: ListNotificationsOptions = {},
): Promise<NotificationInbox> {
  const all = seeded();
  const rows = options.unreadOnly ? all.filter((row) => !row.read) : all;

  return {
    notifications: [...rows]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, options.limit ?? 20),
    unreadCount: all.filter((row) => !row.read).length,
  };
}

export async function readNotification(
  _context: InboxContext,
  id: string,
): Promise<NotificationView | null> {
  return seeded().find((row) => row.id === id) ?? null;
}

export async function unreadNotificationCount(_context: InboxContext): Promise<number> {
  return seeded().filter((row) => !row.read).length;
}

export const markReadSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});
export type MarkReadInput = z.infer<typeof markReadSchema>;

export async function markNotificationsRead(
  _context: InboxContext,
  input: MarkReadInput,
): Promise<number> {
  const rows = seeded();
  const targets = input.all ? rows : rows.filter((row) => input.ids?.includes(row.id));
  let changed = 0;

  for (const row of targets) {
    if (row.read) continue;
    row.read = true;
    row.readAt = new Date().toISOString();
    changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Fan-out (worker-side — not part of the frontend phase)
// ---------------------------------------------------------------------------

export interface FanOutOptions {
  tenantId: string;
}

export interface FanOutResult {
  created: number;
}

export async function deliverEventNotifications(): Promise<FanOutResult> {
  // TODO(BACKEND): the fan-out runs in @cc/workers off the outbox.
  return { created: 0 };
}

export interface NotificationRecipientRow {
  userId: string;
  email: string;
}

export interface ResolveRecipientsInput {
  tenantId: string;
}

export async function resolveRecipients(): Promise<NotificationRecipientRow[]> {
  return [];
}

export function getNotificationSender(): null {
  // TODO(BACKEND): email goes through @cc/adapter-notifications.
  return null;
}

export function portalUrl(path: string): string {
  return path;
}
