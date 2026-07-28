import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import { slaDeadline, TICKET_PRIORITIES, type TicketPriority } from "@cc/domain";

/**
 * SLA breach detection (docs/03 Module 8 flow: "SLA breach → escalate";
 * docs/07 A3 "SLA timers computed, breach events via outbox").
 *
 * A breach is a *deadline passing with nothing happening*, which is the one
 * kind of fact no transaction can produce: there is no write at the moment it
 * becomes true. So it is swept rather than emitted, and the sweep runs in
 * `@cc/workers` on a repeatable job (ADR-029).
 *
 * The query is the interesting part. A naive sweep would load every open
 * ticket and ask `slaBreachDue` about each, which is O(open tickets) per tick
 * for a fact that concerns a handful. Instead the deadline is inverted per
 * priority: for a 4-hour SLA, "breached" means `openedAt < now - 4h`, and
 * that is an index range on the column the workbench already indexes. The
 * registry stays the authority for the hours — `slaDeadline` is what computes
 * the cutoff — so there is still exactly one definition of the window.
 */

export interface SlaBreach {
  ticketId: string;
  ticketNo: string;
  kunnr: string;
  priority: TicketPriority;
  deadline: Date;
  assigneeUserId: string | null;
}

/**
 * Inverts `slaDeadline`: the latest `openedAt` that has already breached.
 *
 * Derived by subtracting the same offset the registry adds, rather than by
 * naming the hours again here — change a priority's window and both the chip
 * and the sweep move together.
 */
function breachedBefore(priority: TicketPriority, now: Date): Date {
  const windowMs = slaDeadline(now, priority).getTime() - now.getTime();
  return new Date(now.getTime() - windowMs);
}

/**
 * Emits `support.sla.breached` for every open ticket that has passed its
 * deadline and not yet been reported.
 *
 * `slaBreachedAt` is the idempotency: it is set in the same transaction as
 * the event (ADR-023), and only rows where it is null are selected, so a
 * sweep that runs every minute reports each breach exactly once. A reopen
 * clears it, because a reopened ticket is a fresh window that can breach
 * again — and the dedupe key includes the window's start for the same reason.
 */
export async function sweepSlaBreaches(
  tenantId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<SlaBreach[]> {
  const now = options.now ?? new Date();

  const due = await runWithTenant(tenantId, () =>
    db.supportTicket.findMany({
      where: {
        status: { in: ["open", "in_progress"] },
        slaBreachedAt: null,
        OR: TICKET_PRIORITIES.map((priority) => ({
          priority,
          openedAt: { lt: breachedBefore(priority, now) },
        })),
      },
      orderBy: { openedAt: "asc" },
      take: options.limit ?? 200,
      select: {
        id: true,
        ticketNo: true,
        customerKunnr: true,
        priority: true,
        openedAt: true,
        assigneeUserId: true,
      },
    }),
  );

  const breaches: SlaBreach[] = [];

  for (const ticket of due) {
    const deadline = slaDeadline(ticket.openedAt, ticket.priority);

    await runWithTenant(tenantId, () =>
      db.$transaction(async (tx) => {
        // Re-checked inside the transaction so two sweeps running at once
        // (a slow tick overlapping the next) can't both claim the same
        // breach: the second update matches zero rows.
        const claimed = await tx.supportTicket.updateMany({
          where: { id: ticket.id, slaBreachedAt: null },
          data: { slaBreachedAt: now },
        });
        if (claimed.count === 0) return;

        await writeOutboxEvent(tx, {
          name: "support.sla.breached",
          payload: {
            occurredAt: deadline,
            ticketId: ticket.id,
            ticketNo: ticket.ticketNo,
            kunnr: ticket.customerKunnr,
            priority: ticket.priority,
            deadline,
            assigneeUserId: ticket.assigneeUserId ?? undefined,
          },
          // Keyed by the window, not the ticket: a ticket reopened and
          // breached again is a second, genuine breach.
          dedupeKey: `support.sla.breached:${ticket.id}:${ticket.openedAt.toISOString()}`,
        });

        breaches.push({
          ticketId: ticket.id,
          ticketNo: ticket.ticketNo,
          kunnr: ticket.customerKunnr,
          priority: ticket.priority,
          deadline,
          assigneeUserId: ticket.assigneeUserId,
        });
      }),
    );
  }

  return breaches;
}
