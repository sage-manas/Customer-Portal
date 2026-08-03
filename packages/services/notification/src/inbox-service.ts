import { db, runWithTenant } from "@cc/db";
import type { NotificationSeverity } from "@cc/domain";
import { z } from "zod";

import { NotificationServiceError, invalidFrom } from "./errors";

/**
 * The bell inbox (docs/05 §6.4, §4.2).
 *
 * Every read here is scoped by **tenant and user** — `runWithTenant` handles
 * the first, and `userId` is a mandatory argument on every function rather
 * than an optional filter, so there is no shape of call that returns another
 * person's notifications. That is the same instinct as ADR-032's separate
 * adapter methods: the dangerous read should not be reachable by leaving an
 * argument off.
 *
 * There is deliberately **no back-office "all notifications" view**. A bell
 * is a personal inbox; a tenant-wide feed of everything the portal has told
 * everybody is a different product, and it would let a support agent read a
 * buyer's account notifications without any KUNNR check.
 */

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
  /** Bell dropdowns are short lists; the page asks for more. */
  limit?: number;
  /** Only what hasn't been read — the badge's own query. */
  unreadOnly?: boolean;
}

export interface NotificationInbox {
  notifications: NotificationView[];
  unreadCount: number;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const SELECT = {
  id: true,
  eventName: true,
  templateKey: true,
  severity: true,
  title: true,
  body: true,
  href: true,
  customerKunnr: true,
  readAt: true,
  occurredAt: true,
} as const;

export async function listNotifications(
  context: InboxContext,
  options: ListNotificationsOptions = {},
): Promise<NotificationInbox> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  return runWithTenant(context.tenantId, async () => {
    const [rows, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: {
          userId: context.userId,
          ...(options.unreadOnly ? { readAt: null } : {}),
        },
        select: SELECT,
        // Newest fact first, not newest row: see `occurredAt` on the model.
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      db.notification.count({ where: { userId: context.userId, readAt: null } }),
    ]);

    return { notifications: rows.map(toView), unreadCount };
  });
}

/** The badge alone, for a poll that must stay cheap. */
export function unreadNotificationCount(context: InboxContext): Promise<number> {
  return runWithTenant(context.tenantId, () =>
    db.notification.count({ where: { userId: context.userId, readAt: null } }),
  );
}

export const markReadSchema = z.object({
  /** Omit to mark everything this user can see. */
  ids: z.array(z.string().min(1)).max(MAX_LIMIT).optional(),
});

export type MarkReadInput = z.infer<typeof markReadSchema>;

/**
 * Marks notifications read.
 *
 * Idempotent, and the `where` carries `readAt: null` so a second call
 * updates nothing rather than rewriting the timestamp — "when did you first
 * see this" is the useful reading of that column.
 *
 * A bad id is silently not-updated rather than a 404. The alternative would
 * answer "does notification X exist?" for an id the caller guessed, which is
 * the cross-tenant probe CLAUDE.md rule 5 exists to prevent, and there is
 * nothing a caller could usefully do with the answer anyway.
 */
export async function markNotificationsRead(
  context: InboxContext,
  input: unknown,
): Promise<{ updated: number; unreadCount: number }> {
  const parsed = markReadSchema.safeParse(input ?? {});
  if (!parsed.success) throw invalidFrom(parsed.error);

  const ids = parsed.data.ids;

  return runWithTenant(context.tenantId, async () => {
    const updated = await db.notification.updateMany({
      where: {
        userId: context.userId,
        readAt: null,
        ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });

    const unreadCount = await db.notification.count({
      where: { userId: context.userId, readAt: null },
    });

    return { updated: updated.count, unreadCount };
  });
}

/**
 * One notification, for a "open it and mark it read" click.
 *
 * 404 for another user's row, as everywhere else — never 403.
 */
export async function readNotification(
  context: InboxContext,
  id: string,
): Promise<NotificationView> {
  const row = await runWithTenant(context.tenantId, () =>
    db.notification.findFirst({
      where: { id, userId: context.userId },
      select: SELECT,
    }),
  );

  if (!row) throw new NotificationServiceError("not_found");
  return toView(row);
}

function toView(row: {
  id: string;
  eventName: string;
  templateKey: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
  customerKunnr: string | null;
  readAt: Date | null;
  occurredAt: Date;
}): NotificationView {
  return {
    id: row.id,
    eventName: row.eventName,
    templateKey: row.templateKey,
    severity: row.severity,
    title: row.title,
    body: row.body,
    href: row.href,
    customerKunnr: row.customerKunnr,
    read: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    occurredAt: row.occurredAt.toISOString(),
  };
}
