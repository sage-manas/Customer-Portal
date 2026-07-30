import { randomUUID } from "node:crypto";

import { LogNotificationSender } from "@cc/adapter-notifications";
import { db, runWithTenant } from "@cc/db";
import { parseEventPayload } from "@cc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deliverEventNotifications } from "../fanout";
import {
  listNotifications,
  markNotificationsRead,
  readNotification,
  unreadNotificationCount,
} from "../inbox-service";
import { resolveRecipients } from "../recipients";

/**
 * The notification module against a real database: fan-out from a relayed
 * event to bell rows, the two recipient rules, the email mirror, the
 * redelivery no-op, and the inbox reads — plus the boundaries that matter,
 * which here are cross-tenant, cross-account and cross-*user*.
 *
 * Requires Postgres (see the package README).
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
const occurredAt = new Date("2026-07-20T09:00:00.000Z");

describe("notification fan-out and inbox", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  /** Two buyers on KUNNR, one buyer on another account, one support agent. */
  let buyer: { id: string };
  let colleague: { id: string };
  let otherBuyer: { id: string };
  let agent: { id: string };
  let tenantBBuyer: { id: string };

  async function makeUser(
    tenantId: string,
    email: string,
    roles: ("buyer_admin" | "buyer_user" | "tenant_support")[],
    kunnr?: string,
  ) {
    const user = await runWithTenant(tenantId, () =>
      db.user.create({ data: { tenantId, email, roles } }),
    );
    if (kunnr) {
      await runWithTenant(tenantId, () =>
        db.userAccountLink.create({ data: { tenantId, userId: user.id, sapKunnr: kunnr } }),
      );
    }
    return user;
  }

  async function wipeNotifications() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, () => db.notification.deleteMany());
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({
      data: { slug: `ntf-a-${runId}`, name: "Acme Industrial" },
    });
    tenantB = await db.tenant.create({ data: { slug: `ntf-b-${runId}`, name: "Tenant B" } });

    buyer = await makeUser(tenantA.id, `buyer-${runId}@a.example`, ["buyer_admin"], KUNNR);
    colleague = await makeUser(tenantA.id, `colleague-${runId}@a.example`, ["buyer_user"], KUNNR);
    otherBuyer = await makeUser(
      tenantA.id,
      `other-${runId}@a.example`,
      ["buyer_user"],
      OTHER_KUNNR,
    );
    agent = await makeUser(tenantA.id, `agent-${runId}@a.example`, ["tenant_support"]);
    tenantBBuyer = await makeUser(tenantB.id, `buyer-${runId}@b.example`, ["buyer_admin"], KUNNR);
  });

  beforeEach(wipeNotifications);

  afterAll(async () => {
    await wipeNotifications();
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.userAccountLink.deleteMany();
        await db.user.deleteMany();
      });
    }
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  const orderPayload = (creditBlocked = false) =>
    parseEventPayload("order.created", {
      occurredAt,
      kunnr: KUNNR,
      documentNumber: "0000004711",
      creditBlocked,
    });

  // ---- Recipient resolution ---------------------------------------------

  it("delivers a customer notification to everyone on the account and nobody else", async () => {
    const sender = new LogNotificationSender({ echo: false });

    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-1`,
      "order.created",
      orderPayload(),
      { sender },
    );

    expect(result.created).toBe(2);
    expect(result.recipients).toBe(2);

    const recipients = await runWithTenant(tenantA.id, () =>
      db.notification.findMany({ select: { userId: true } }),
    );
    const ids = recipients.map((row) => row.userId).sort();
    // The colleague is included — an order belongs to the *account*, as the
    // cart and the ticket do. The other account's buyer is not.
    expect(ids).toEqual([buyer.id, colleague.id].sort());
    expect(ids).not.toContain(otherBuyer.id);
    expect(ids).not.toContain(agent.id);
  });

  it("never crosses a tenant, even for the same KUNNR and the same event id", async () => {
    // Two tenants can legitimately have a customer numbered 0010001001, and
    // the relay's job ids are per-tenant rows.
    await deliverEventNotifications(tenantA.id, `evt-${runId}-2`, "order.created", orderPayload(), {
      skipOutbound: true,
    });

    const forB = await runWithTenant(tenantB.id, () => db.notification.findMany());
    expect(forB).toEqual([]);

    await deliverEventNotifications(tenantB.id, `evt-${runId}-2`, "order.created", orderPayload(), {
      skipOutbound: true,
    });
    const bNow = await runWithTenant(tenantB.id, () => db.notification.findMany());
    expect(bNow).toHaveLength(1);
    expect(bNow[0]?.userId).toBe(tenantBBuyer.id);
  });

  it("routes a back-office template to staff by permission, never to a buyer", async () => {
    const payload = parseEventPayload("support.ticket.created", {
      occurredAt,
      ticketId: "tkt_1",
      ticketNo: "TKT-000042",
      kunnr: KUNNR,
      category: "delivery",
      priority: "high",
      subject: "Short shipment on 8000001234",
    });

    // Two templates claim this event — a receipt for the customer and a queue
    // item for the desk — so one event writes rows in both planes.
    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-3`,
      "support.ticket.created",
      payload,
      { skipOutbound: true },
    );

    expect(result.created).toBe(3); // buyer + colleague + agent

    const rows = await runWithTenant(tenantA.id, () =>
      db.notification.findMany({
        select: { userId: true, templateKey: true, customerKunnr: true },
      }),
    );

    const deskRow = rows.find((row) => row.templateKey.endsWith(".desk"));
    expect(deskRow?.userId).toBe(agent.id);
    // A back-office row carries no KUNNR: it is about the tenant's work, not
    // the recipient's own account.
    expect(deskRow?.customerKunnr).toBeNull();

    const customerRows = rows.filter((row) => row.templateKey.endsWith(".customer"));
    expect(customerRows.map((row) => row.userId).sort()).toEqual([buyer.id, colleague.id].sort());
    expect(customerRows.every((row) => row.customerKunnr === KUNNR)).toBe(true);
  });

  it("resolves nobody for a customer template with no account on the event", async () => {
    // The failure this prevents is the loud one: treating a missing KUNNR as
    // "everybody" would mail one customer's order confirmation to the tenant.
    const recipients = await resolveRecipients({
      tenantId: tenantA.id,
      audience: "customer",
      permission: "order:view",
    });
    expect(recipients).toEqual([]);
  });

  it("ignores a deactivated user", async () => {
    await runWithTenant(tenantA.id, () =>
      db.user.update({ where: { id: colleague.id }, data: { isActive: false } }),
    );

    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-4`,
      "order.created",
      orderPayload(),
      { skipOutbound: true },
    );

    await runWithTenant(tenantA.id, () =>
      db.user.update({ where: { id: colleague.id }, data: { isActive: true } }),
    );

    expect(result.created).toBe(1);
  });

  it("writes nothing for an event no template claims", async () => {
    const payload = parseEventPayload("payment.captured", {
      occurredAt,
      paymentId: "pay_1",
      kunnr: KUNNR,
      amount: 1000,
      currency: "INR",
    });

    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-5`,
      "payment.captured",
      payload,
      { skipOutbound: true },
    );

    expect(result).toEqual({ created: 0, recipients: 0, emailsSent: 0, emailsFailed: 0 });
    expect(await runWithTenant(tenantA.id, () => db.notification.count({}))).toBe(0);
  });

  // ---- Idempotency and the email mirror ----------------------------------

  it("is a no-op when the relay delivers the same event twice (ADR-023)", async () => {
    const sender = new LogNotificationSender({ echo: false });
    const eventId = `evt-${runId}-6`;

    const first = await deliverEventNotifications(
      tenantA.id,
      eventId,
      "order.created",
      orderPayload(),
      { sender },
    );
    const second = await deliverEventNotifications(
      tenantA.id,
      eventId,
      "order.created",
      orderPayload(),
      { sender },
    );

    expect(first.created).toBe(2);
    expect(first.emailsSent).toBe(2);
    // Not one row more, and — the part that matters to a customer — not one
    // mail more. The second pass finds `emailSentAt` already set.
    expect(second.created).toBe(0);
    expect(second.emailsSent).toBe(0);
    expect(sender.sent).toHaveLength(2);
    expect(await runWithTenant(tenantA.id, () => db.notification.count({}))).toBe(2);
  });

  it("mails what the template rendered, with a deep link and an idempotency key", async () => {
    const sender = new LogNotificationSender({ echo: false });
    process.env.ROOT_DOMAIN = "localhost";
    process.env.PORTAL_PORT = "3000";

    await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-7`,
      "order.created",
      orderPayload(true),
      { sender },
    );

    delete process.env.PORTAL_PORT;

    const mail = sender.sent.find((message) => message.recipient.userId === buyer.id);
    expect(mail?.subject).toMatch(/hold/i);
    expect(mail?.tenantName).toBe("Acme Industrial");
    expect(mail?.url).toBe(`http://${tenantA.slug}.localhost:3000/orders/0000004711`);
    expect(mail?.idempotencyKey).toContain(buyer.id);
  });

  it("records a failed mail on the row and keeps the bell notification", async () => {
    const failing = {
      driver: "log" as const,
      channels: ["email"] as const,
      send: () => Promise.resolve({ delivered: false, error: "Provider answered 503" }),
    };

    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-8`,
      "order.created",
      orderPayload(),
      { sender: failing },
    );

    expect(result.created).toBe(2);
    expect(result.emailsFailed).toBe(2);

    const rows = await runWithTenant(tenantA.id, () =>
      db.notification.findMany({ select: { emailSentAt: true, emailError: true, title: true } }),
    );
    // The customer can still see it. The mail is what failed, and the row
    // says so for B4's exception tray.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.emailSentAt === null)).toBe(true);
    expect(rows[0]?.emailError).toContain("503");
  });

  it("does not mail a template that asks only for the bell", async () => {
    const sender = new LogNotificationSender({ echo: false });
    const payload = parseEventPayload("delivery.receipt.confirmed", {
      occurredAt,
      kunnr: KUNNR,
      documentNumber: "0080001234",
      salesOrder: "0000004711",
      receiptDate: "2026-07-20",
    });

    const result = await deliverEventNotifications(
      tenantA.id,
      `evt-${runId}-9`,
      "delivery.receipt.confirmed",
      payload,
      { sender },
    );

    expect(result.created).toBe(2);
    expect(sender.sent).toEqual([]);
  });

  // ---- The inbox ---------------------------------------------------------

  describe("the inbox", () => {
    beforeEach(async () => {
      await deliverEventNotifications(
        tenantA.id,
        `evt-${runId}-inbox-1`,
        "order.created",
        orderPayload(),
        { skipOutbound: true },
      );
      await deliverEventNotifications(
        tenantA.id,
        `evt-${runId}-inbox-2`,
        "quotation.issued",
        parseEventPayload("quotation.issued", {
          occurredAt: new Date("2026-07-21T09:00:00.000Z"),
          kunnr: KUNNR,
          documentNumber: "0020000001",
          validUntil: "2026-08-31",
          grossValue: 125000,
          currency: "INR",
        }),
        { skipOutbound: true },
      );
    });

    it("lists a user's own notifications, newest fact first", async () => {
      const inbox = await listNotifications({ tenantId: tenantA.id, userId: buyer.id });

      expect(inbox.notifications).toHaveLength(2);
      expect(inbox.unreadCount).toBe(2);
      expect(inbox.notifications[0]?.eventName).toBe("quotation.issued");
      expect(inbox.notifications[0]?.href).toBe("/quotations/0020000001");
      expect(inbox.notifications[0]?.read).toBe(false);
    });

    it("shows a colleague nothing of what this user has read", async () => {
      await markNotificationsRead({ tenantId: tenantA.id, userId: buyer.id }, {});

      // Read/unread is a fact about a person, not about the account: the
      // colleague's bell is untouched.
      expect(await unreadNotificationCount({ tenantId: tenantA.id, userId: buyer.id })).toBe(0);
      expect(await unreadNotificationCount({ tenantId: tenantA.id, userId: colleague.id })).toBe(2);
    });

    it("marks one notification read without touching the rest", async () => {
      const inbox = await listNotifications({ tenantId: tenantA.id, userId: buyer.id });
      const target = inbox.notifications[0]!;

      const result = await markNotificationsRead(
        { tenantId: tenantA.id, userId: buyer.id },
        { ids: [target.id] },
      );

      expect(result).toEqual({ updated: 1, unreadCount: 1 });
    });

    it("keeps the first-seen timestamp when marked read twice", async () => {
      const context = { tenantId: tenantA.id, userId: buyer.id };
      await markNotificationsRead(context, {});
      const first = await listNotifications(context);

      const again = await markNotificationsRead(context, {});
      const after = await listNotifications(context);

      expect(again.updated).toBe(0);
      expect(after.notifications[0]?.readAt).toBe(first.notifications[0]?.readAt);
    });

    it("filters to unread when asked", async () => {
      const context = { tenantId: tenantA.id, userId: buyer.id };
      const all = await listNotifications(context);
      await markNotificationsRead(context, { ids: [all.notifications[0]!.id] });

      const unread = await listNotifications(context, { unreadOnly: true });

      expect(unread.notifications).toHaveLength(1);
      expect(unread.notifications[0]?.eventName).toBe("order.created");
    });

    it("answers 404 for another user's notification, never 403", async () => {
      const inbox = await listNotifications({ tenantId: tenantA.id, userId: buyer.id });
      const id = inbox.notifications[0]!.id;

      // The agent is in the same tenant and holds more permissions than the
      // buyer; a bell row is still not theirs to read.
      await expect(
        readNotification({ tenantId: tenantA.id, userId: agent.id }, id),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    });

    it("silently ignores an id that isn't the caller's rather than confirming it", async () => {
      const inbox = await listNotifications({ tenantId: tenantA.id, userId: buyer.id });
      const notMine = inbox.notifications[0]!.id;

      const result = await markNotificationsRead(
        { tenantId: tenantA.id, userId: otherBuyer.id },
        { ids: [notMine] },
      );

      expect(result.updated).toBe(0);
      // And it really is still unread for the person it belongs to.
      expect(await unreadNotificationCount({ tenantId: tenantA.id, userId: buyer.id })).toBe(2);
    });
  });
});
