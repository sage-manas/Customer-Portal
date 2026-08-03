import { randomUUID } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import { slaDeadline } from "@cc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { raiseDiscrepancyTicket } from "../auto-ticket";
import { isSupportError, type SupportError } from "../errors";
import { sweepSlaBreaches } from "../sla-service";
import {
  addCustomerComment,
  createTicket,
  getTicket,
  listTickets,
  rateTicket,
  transitionTicketAsCustomer,
} from "../ticket-service";
import {
  addAgentComment,
  assignTicket,
  getTicketForAgent,
  listWorkbench,
  resolveTicket,
  transitionTicketAsAgent,
} from "../workbench-service";

/**
 * The support module end to end against a real database: raise, comment,
 * assign, resolve, reopen, rate; the SLA sweep; the POD-discrepancy
 * auto-ticket; and the three boundaries that matter — cross-tenant,
 * cross-customer, and the internal note a customer must never see.
 *
 * Requires Postgres (see the package README).
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";

const validTicket = {
  category: "billing" as const,
  priority: "high" as const,
  subject: "Invoice 90000123 shows the wrong GST",
  description: "The invoice charges IGST but both parties are registered in Maharashtra.",
  attachmentKeys: [],
};

async function expectSupportError(fn: () => Promise<unknown>): Promise<SupportError> {
  try {
    await fn();
  } catch (error) {
    if (isSupportError(error)) return error;
    throw error;
  }
  throw new Error("Expected a SupportError to be thrown");
}

describe("support ticket flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  const customer = () => ({ tenantId: tenantA.id, kunnr: KUNNR, userId: "user_buyer" });
  const otherCustomer = () => ({ tenantId: tenantA.id, kunnr: OTHER_KUNNR, userId: "user_other" });
  const agent = () => ({ tenantId: tenantA.id, userId: "user_agent" });

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.ticketAttachment.deleteMany();
        await db.ticketComment.deleteMany();
        await db.supportTicket.deleteMany();
        await db.ticketCounter.deleteMany();
        await db.outboxEvent.deleteMany();
      });
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `sup-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `sup-b-${runId}`, name: "Tenant B" } });
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  // ---- Raise --------------------------------------------------------------

  it("raises a ticket, numbers it per tenant and announces it on the outbox", async () => {
    const ticket = await createTicket(customer(), validTicket);

    expect(ticket.ticketNo).toBe("TKT-000001");
    expect(ticket.status).toBe("open");
    expect(ticket.customerKunnr).toBe(KUNNR);
    expect(ticket.sla.state).toBe("ok");
    expect(ticket.sla.deadline).toEqual(slaDeadline(ticket.openedAt, "high"));

    const events = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findMany({ select: { eventName: true } }),
    );
    expect(events.map((e) => e.eventName)).toEqual(["support.ticket.created"]);

    // The event and the ticket are one commit (ADR-023) — a ticket nobody
    // was told about misses its SLA silently.
    const second = await createTicket(customer(), validTicket);
    expect(second.ticketNo).toBe("TKT-000002");
  });

  it("numbers each tenant's tickets from one", async () => {
    await createTicket(customer(), validTicket);
    const forB = await createTicket({ tenantId: tenantB.id, kunnr: KUNNR }, validTicket);

    // A shared sequence would make TKT-000002 mean "the second ticket on the
    // platform" and leak how busy the other tenant is.
    expect(forB.ticketNo).toBe("TKT-000001");
  });

  it("refuses a related document the customer doesn't own", async () => {
    const error = await expectSupportError(() =>
      createTicket(
        customer(),
        { ...validTicket, relatedDocType: "invoice", relatedDocNumber: "90000999" },
        { validateRelatedDoc: async () => false },
      ),
    );

    expect(error.code).toBe("invalid");
    expect(error.issues[0]?.field).toBe("relatedDocNumber");
  });

  it("keeps a related document that does check out", async () => {
    const ticket = await createTicket(
      customer(),
      { ...validTicket, relatedDocType: "invoice", relatedDocNumber: "90000123" },
      { validateRelatedDoc: async () => true },
    );

    expect(ticket.relatedDocType).toBe("invoice");
    expect(ticket.relatedDocNumber).toBe("90000123");
  });

  it("rejects a subject longer than QMTXT allows", async () => {
    const error = await expectSupportError(() =>
      createTicket(customer(), { ...validTicket, subject: "x".repeat(41) }),
    );
    expect(error.code).toBe("invalid");
  });

  // ---- Boundaries ---------------------------------------------------------

  it("answers 404 for another customer's ticket, never 403", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const error = await expectSupportError(() => getTicket(otherCustomer(), ticket.id));

    // Identical to a ticket that never existed: the portal must not confirm
    // that another customer's data exists (CLAUDE.md rule 5).
    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
  });

  it("answers 404 for another tenant's ticket", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const error = await expectSupportError(() =>
      getTicket({ tenantId: tenantB.id, kunnr: KUNNR }, ticket.id),
    );
    expect(error.code).toBe("not_found");
  });

  it("shows a colleague on the same account the ticket a co-worker raised", async () => {
    // A ticket belongs to the account, not to the person: the buyer who
    // raised it goes on holiday, the problem does not.
    const ticket = await createTicket(customer(), validTicket);

    const asColleague = await getTicket(
      { tenantId: tenantA.id, kunnr: KUNNR, userId: "user_colleague" },
      ticket.id,
    );
    expect(asColleague.id).toBe(ticket.id);
  });

  it("refuses to work at all for a session with no sold-to account", async () => {
    const error = await expectSupportError(() =>
      listTickets({ tenantId: tenantA.id, kunnr: undefined }),
    );
    expect(error.code).toBe("no_account");
  });

  // ---- Internal notes -----------------------------------------------------

  it("never returns an internal note to the customer, but does to an agent", async () => {
    const ticket = await createTicket(customer(), validTicket);

    await addAgentComment(agent(), ticket.id, {
      body: "Chasing the finance team; do not promise a date yet.",
      internal: true,
      attachmentKeys: [],
    });
    await addAgentComment(agent(), ticket.id, {
      body: "We're looking into it and will come back to you today.",
      internal: false,
      attachmentKeys: [],
    });

    const asCustomer = await getTicket(customer(), ticket.id);
    const asAgent = await getTicketForAgent(agent(), ticket.id);

    expect(asCustomer.comments).toHaveLength(1);
    expect(asCustomer.comments[0]?.internal).toBe(false);
    expect(asAgent.comments).toHaveLength(2);
  });

  it("refuses a customer's attempt to post an internal note", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const error = await expectSupportError(() =>
      addCustomerComment(customer(), ticket.id, {
        body: "sneaking this in",
        internal: true,
        attachmentKeys: [],
      }),
    );

    // Refused, not silently downgraded: writing it as visible would put the
    // customer's words where the back office keeps its own.
    expect(error.code).toBe("invalid");
    const stored = await getTicketForAgent(agent(), ticket.id);
    expect(stored.comments).toHaveLength(0);
  });

  // ---- The lifecycle ------------------------------------------------------

  it("walks open -> in progress -> resolved -> closed", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const started = await transitionTicketAsAgent(agent(), ticket.id, "in_progress");
    expect(started.status).toBe("in_progress");
    expect(started.startedAt).not.toBeNull();

    const resolved = await resolveTicket(agent(), ticket.id, {
      resolution: "Credit note 91000045 issued for the tax difference.",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.sla.state).toBe("met");
    expect(resolved.resolution).toContain("91000045");

    const closed = await transitionTicketAsCustomer(customer(), ticket.id, "closed");
    expect(closed.status).toBe("closed");
    expect(closed.timeline.every((stage) => stage.reached)).toBe(true);

    const events = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findMany({ select: { eventName: true }, orderBy: { createdAt: "asc" } }),
    );
    expect(events.map((e) => e.eventName)).toEqual([
      "support.ticket.created",
      "support.ticket.resolved",
    ]);
  });

  it("never lets a customer resolve their own ticket", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const error = await expectSupportError(() =>
      transitionTicketAsCustomer(customer(), ticket.id, "resolved"),
    );

    // Self-resolution would let the SLA be met by the person it protects.
    expect(error.code).toBe("not_allowed");
  });

  it("refuses a resolution with no resolution text", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const error = await expectSupportError(() =>
      resolveTicket(agent(), ticket.id, { resolution: "done" }),
    );
    expect(error.code).toBe("invalid");
  });

  it("restarts the SLA clock on reopen and clears the breach flag", async () => {
    const ticket = await createTicket(customer(), validTicket);
    await resolveTicket(agent(), ticket.id, {
      resolution: "Credit note issued for the tax difference.",
    });

    // Backdate the opening so the original window is long gone, and mark it
    // breached as the sweep would have.
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await runWithTenant(tenantA.id, () =>
      db.supportTicket.update({
        where: { id: ticket.id },
        data: { openedAt: longAgo, slaBreachedAt: longAgo },
      }),
    );

    const reopened = await transitionTicketAsCustomer(customer(), ticket.id, "open");

    expect(reopened.status).toBe("open");
    expect(reopened.sla.state).toBe("ok");
    expect(reopened.slaBreachedAt).toBeNull();
    expect(reopened.openedAt.getTime()).toBeGreaterThan(longAgo.getTime());
  });

  it("refuses a reopen after the 7-day window", async () => {
    const ticket = await createTicket(customer(), validTicket);
    await resolveTicket(agent(), ticket.id, { resolution: "Nothing further to do here." });

    await runWithTenant(tenantA.id, () =>
      db.supportTicket.update({
        where: { id: ticket.id },
        data: { resolvedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      }),
    );

    const error = await expectSupportError(() =>
      transitionTicketAsCustomer(customer(), ticket.id, "open"),
    );
    expect(error.code).toBe("not_allowed");
  });

  it("refuses a comment on a closed ticket", async () => {
    const ticket = await createTicket(customer(), validTicket);
    await transitionTicketAsCustomer(customer(), ticket.id, "closed");

    const error = await expectSupportError(() =>
      addCustomerComment(customer(), ticket.id, {
        body: "one more thing",
        internal: false,
        attachmentKeys: [],
      }),
    );
    expect(error.code).toBe("not_allowed");
  });

  // ---- CSAT ---------------------------------------------------------------

  it("takes one rating, only after a resolution", async () => {
    const ticket = await createTicket(customer(), validTicket);

    const tooEarly = await expectSupportError(() =>
      rateTicket(customer(), ticket.id, { rating: 5 }),
    );
    expect(tooEarly.code).toBe("not_allowed");

    await resolveTicket(agent(), ticket.id, { resolution: "Credit note issued; sorry for that." });

    const rated = await rateTicket(customer(), ticket.id, { rating: 4, comment: "Quick fix." });
    expect(rated.rating).toBe(4);

    const twice = await expectSupportError(() => rateTicket(customer(), ticket.id, { rating: 1 }));
    expect(twice.code).toBe("not_allowed");
  });

  // ---- The workbench ------------------------------------------------------

  it("sorts the workbench most-urgent-first, then oldest-first", async () => {
    await createTicket(customer(), { ...validTicket, priority: "low" });
    await createTicket(customer(), { ...validTicket, priority: "critical" });
    await createTicket(customer(), { ...validTicket, priority: "medium" });

    const queue = await listWorkbench(agent(), { filter: "open" });

    expect(queue.tickets.map((t) => t.priority)).toEqual(["critical", "medium", "low"]);
    expect(queue.counts.open).toBe(3);
    expect(queue.counts.unassigned).toBe(3);
  });

  it("shows an agent every account's tickets, but only their own tenant's", async () => {
    await createTicket(customer(), validTicket);
    await createTicket(otherCustomer(), validTicket);
    await createTicket({ tenantId: tenantB.id, kunnr: KUNNR }, validTicket);

    const queue = await listWorkbench(agent(), { filter: "all" });

    // The tenant is the boundary in the back office; the account is not.
    expect(queue.total).toBe(2);
    expect(new Set(queue.tickets.map((t) => t.customerKunnr))).toEqual(
      new Set([KUNNR, OTHER_KUNNR]),
    );
  });

  it("moves a ticket in and out of an agent's own queue", async () => {
    const ticket = await createTicket(customer(), validTicket);

    await assignTicket(agent(), ticket.id, "user_agent");
    expect((await listWorkbench(agent(), { filter: "mine" })).total).toBe(1);

    await assignTicket(agent(), ticket.id, null);
    expect((await listWorkbench(agent(), { filter: "mine" })).total).toBe(0);
    expect((await listWorkbench(agent(), { filter: "unassigned" })).total).toBe(1);
  });

  it("filters the customer's own list by state and counts the tabs", async () => {
    const first = await createTicket(customer(), validTicket);
    await createTicket(customer(), validTicket);
    await resolveTicket(agent(), first.id, { resolution: "Sorted, credit note issued." });

    const open = await listTickets(customer(), { filter: "open" });
    const resolved = await listTickets(customer(), { filter: "resolved" });

    expect(open.total).toBe(1);
    expect(resolved.total).toBe(1);
    expect(open.counts).toMatchObject({ all: 2, open: 1, resolved: 1, closed: 0 });
  });

  // ---- SLA sweep ----------------------------------------------------------

  it("emits one breach event per window and never twice", async () => {
    const ticket = await createTicket(customer(), { ...validTicket, priority: "critical" });

    // Nothing is due while the window is open.
    expect(await sweepSlaBreaches(tenantA.id)).toEqual([]);

    await runWithTenant(tenantA.id, () =>
      db.supportTicket.update({
        where: { id: ticket.id },
        data: { openedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
      }),
    );

    const breaches = await sweepSlaBreaches(tenantA.id);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.ticketNo).toBe(ticket.ticketNo);

    // The second sweep finds nothing: slaBreachedAt is set in the same
    // transaction as the event, so a sweep every minute reports each breach
    // exactly once.
    expect(await sweepSlaBreaches(tenantA.id)).toEqual([]);

    const events = await runWithTenant(tenantA.id, () =>
      db.outboxEvent.findMany({ where: { eventName: "support.sla.breached" } }),
    );
    expect(events).toHaveLength(1);
  });

  it("never breaches a ticket that was resolved in time", async () => {
    const ticket = await createTicket(customer(), { ...validTicket, priority: "critical" });
    await resolveTicket(agent(), ticket.id, { resolution: "Answered within the hour." });

    await runWithTenant(tenantA.id, () =>
      db.supportTicket.update({
        where: { id: ticket.id },
        data: { openedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) },
      }),
    );

    expect(await sweepSlaBreaches(tenantA.id)).toEqual([]);
  });

  it("respects each priority's own window", async () => {
    // Six hours old: past a 4-hour critical SLA, well inside a 24-hour
    // medium one. A sweep with one hard-coded window would get this wrong.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const critical = await createTicket(customer(), { ...validTicket, priority: "critical" });
    const medium = await createTicket(customer(), { ...validTicket, priority: "medium" });

    await runWithTenant(tenantA.id, () =>
      db.supportTicket.updateMany({
        where: { id: { in: [critical.id, medium.id] } },
        data: { openedAt: sixHoursAgo },
      }),
    );

    const breaches = await sweepSlaBreaches(tenantA.id);
    expect(breaches.map((b) => b.ticketId)).toEqual([critical.id]);
  });

  // ---- Auto-ticket from a POD discrepancy ---------------------------------

  it("raises a Delivery ticket from a POD discrepancy, and only one", async () => {
    const payload = {
      occurredAt: new Date(),
      kunnr: KUNNR,
      documentNumber: "0080001947",
      salesOrder: "0000004712",
      reason: "MAT-20002: received 140 M of 150 dispatched",
      reportedByUserId: "user_buyer",
      notes: "Two pallets were water-damaged.",
      lines: [{ lineNo: 10, material: "MAT-20002", dispatchedQty: 150, receivedQty: 140 }],
    };

    const first = await raiseDiscrepancyTicket(tenantA.id, payload);
    const ticket = await getTicketForAgent(agent(), first.ticketId);

    expect(ticket.category).toBe("delivery");
    expect(ticket.priority).toBe("high");
    expect(ticket.relatedDocNumber).toBe("0080001947");
    expect(ticket.description).toContain("received 140 of 150");
    expect(ticket.description).toContain("water-damaged");
    expect(ticket.subject.length).toBeLessThanOrEqual(40);

    // The relay is at-least-once (ADR-023), so the handler must be idempotent
    // — a redelivered event returns the ticket that already exists.
    const again = await raiseDiscrepancyTicket(tenantA.id, payload);
    expect(again.ticketId).toBe(first.ticketId);

    const count = await runWithTenant(tenantA.id, () => db.supportTicket.count());
    expect(count).toBe(1);
  });

  it("gives the auto-raised ticket the same SLA clock as a typed one", async () => {
    const { ticketId } = await raiseDiscrepancyTicket(tenantA.id, {
      occurredAt: new Date(),
      kunnr: KUNNR,
      documentNumber: "0080001948",
      salesOrder: "0000004713",
      reason: "short",
      lines: [],
    });

    const ticket = await getTicketForAgent(agent(), ticketId);
    expect(ticket.sla.deadline).toEqual(slaDeadline(ticket.openedAt, "high"));
    expect(ticket.ticketNo).toMatch(/^TKT-\d{6}$/);
  });
});
