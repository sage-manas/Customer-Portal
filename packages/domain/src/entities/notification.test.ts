import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "../auth";
import { DOMAIN_EVENT_NAMES, parseEventPayload, type DomainEventName } from "../events";
import { ADMIN_NAV, PORTAL_NAV } from "../navigation";

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TEMPLATES,
  isNotifiableEvent,
  notificationKunnr,
  renderNotifications,
  templatesForEvent,
} from "./notification";

const occurredAt = new Date("2026-07-20T09:00:00.000Z");

describe("the template registry", () => {
  it("only names events that exist in the event registry", () => {
    for (const name of Object.keys(NOTIFICATION_TEMPLATES)) {
      expect(DOMAIN_EVENT_NAMES).toContain(name as DomainEventName);
    }
  });

  it("declares only permissions the auth registry knows", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      for (const template of templatesForEvent(name)) {
        expect(PERMISSIONS).toContain(template.permission);
      }
    }
  });

  it("declares only channels that have a driver", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      for (const template of templatesForEvent(name)) {
        expect(template.channels.length).toBeGreaterThan(0);
        for (const channel of template.channels) {
          expect(NOTIFICATION_CHANNELS).toContain(channel);
        }
      }
    }
  });

  it("gives every template a unique key", () => {
    const keys = DOMAIN_EVENT_NAMES.flatMap((name) =>
      templatesForEvent(name).map((template) => template.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sends a back-office template to a back-office screen and a customer one to the portal", () => {
    // The deep link and the permission must agree about which plane the
    // recipient is in — a customer-audience row pointing at /admin would be
    // a link the recipient is guaranteed to be refused at.
    for (const name of DOMAIN_EVENT_NAMES) {
      for (const template of templatesForEvent(name)) {
        const nav = template.audience === "back_office" ? ADMIN_NAV : PORTAL_NAV;
        const permitted = nav.some((item) => item.permission === template.permission);
        expect(permitted, `${template.key} declares ${template.permission}`).toBe(true);
      }
    }
  });

  it("leaves an event with no audience unregistered rather than notifying nobody", () => {
    // Both are deliberate silences, not omissions: a captured payment is a
    // worker's retry instruction, and a POD discrepancy already speaks as the
    // support ticket it raises.
    expect(isNotifiableEvent("payment.captured")).toBe(false);
    expect(isNotifiableEvent("delivery.discrepancy.reported")).toBe(false);
  });
});

describe("rendering", () => {
  it("renders a confirmed order for the customer, deep-linked to it", () => {
    const payload = parseEventPayload("order.created", {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0000004711",
      creditBlocked: false,
    });

    const [rendered] = renderNotifications("order.created", payload);

    expect(rendered?.audience).toBe("customer");
    expect(rendered?.severity).toBe("success");
    expect(rendered?.title).toContain("0000004711");
    expect(rendered?.href).toBe("/orders/0000004711");
  });

  it("says a credit-blocked order is held rather than confirmed", () => {
    const payload = parseEventPayload("order.created", {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0000004711",
      creditBlocked: true,
    });

    const [rendered] = renderNotifications("order.created", payload);

    expect(rendered?.severity).toBe("warning");
    expect(rendered?.title).toMatch(/hold/i);
  });

  it("tells the customer an approved limit is not yet in SAP (ADR-035)", () => {
    const payload = parseEventPayload("credit.increase.decided", {
      occurredAt,
      requestId: "req_1",
      kunnr: "0000012345",
      decision: "approved",
      approvedLimit: 750000,
    });

    const [rendered] = renderNotifications("credit.increase.decided", payload);

    expect(rendered?.body).toMatch(/credit team/i);
    expect(rendered?.body).toContain("7,50,000");
  });

  it("renders one raised ticket twice — a receipt and a queue item", () => {
    const payload = parseEventPayload("support.ticket.created", {
      occurredAt,
      ticketId: "tkt_1",
      ticketNo: "TKT-000042",
      kunnr: "0000012345",
      category: "delivery",
      priority: "high",
      subject: "Short shipment on 8000001234",
    });

    const rendered = renderNotifications("support.ticket.created", payload);

    expect(rendered).toHaveLength(2);
    expect(rendered.map((row) => row.audience)).toEqual(["customer", "back_office"]);
    expect(rendered[0]?.href).toBe("/support/tkt_1");
    expect(rendered[1]?.href).toBe("/admin/tickets/tkt_1");
  });

  it("marks an SLA breach critical", () => {
    const payload = parseEventPayload("support.sla.breached", {
      occurredAt,
      ticketId: "tkt_1",
      ticketNo: "TKT-000042",
      kunnr: "0000012345",
      priority: "critical",
      deadline: new Date("2026-07-20T05:00:00.000Z"),
    });

    const [rendered] = renderNotifications("support.sla.breached", payload);

    expect(rendered?.severity).toBe("critical");
    expect(rendered?.channels).toContain("email");
  });

  it("renders every registered template against its own event's schema", () => {
    // A template is only as safe as the payload it destructures: this walks
    // the registry so a template added for a field the schema doesn't carry
    // fails here rather than inside a worker.
    for (const [name, samples] of Object.entries(SAMPLES) as [DomainEventName, unknown[]][]) {
      for (const sample of samples) {
        const payload = parseEventPayload(name, sample);
        for (const rendered of renderNotifications(name, payload)) {
          expect(rendered.title.length).toBeGreaterThan(0);
          expect(rendered.body.length).toBeGreaterThan(0);
          expect(rendered.href.startsWith("/")).toBe(true);
        }
      }
    }
  });

  it("covers every notifiable event with a sample", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      if (!isNotifiableEvent(name)) continue;
      expect(Object.keys(SAMPLES), `${name} has no sample payload`).toContain(name);
    }
  });
});

describe("notificationKunnr", () => {
  it("reads the account an event concerns", () => {
    expect(notificationKunnr({ kunnr: "0000012345" })).toBe("0000012345");
  });

  it("returns undefined rather than guessing", () => {
    expect(notificationKunnr({})).toBeUndefined();
    expect(notificationKunnr({ kunnr: "" })).toBeUndefined();
    expect(notificationKunnr(null)).toBeUndefined();
  });
});

/** One payload per notifiable event, valid against its registered schema. */
const SAMPLES: Partial<Record<DomainEventName, unknown[]>> = {
  "order.created": [
    { occurredAt, kunnr: "0000012345", documentNumber: "0000004711", creditBlocked: false },
    { occurredAt, kunnr: "0000012345", documentNumber: "0000004711", creditBlocked: true },
  ],
  "delivery.receipt.confirmed": [
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0080001234",
      salesOrder: "0000004711",
      receiptDate: "2026-07-20",
    },
  ],
  "inquiry.created": [
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0010000001",
      requiredDeliveryDate: "2026-08-01",
      lineCount: 3,
    },
  ],
  "quotation.issued": [
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0020000001",
      validUntil: "2026-08-31",
      grossValue: 125000,
      currency: "INR",
    },
  ],
  "quotation.accepted": [
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0020000001",
      salesOrder: "0000004711",
    },
  ],
  "quotation.revision.requested": [
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0020000001",
      comment: "Can you sharpen the freight line?",
      expired: false,
    },
    {
      occurredAt,
      kunnr: "0000012345",
      documentNumber: "0020000001",
      comment: "Please revalidate.",
      expired: true,
    },
  ],
  "payment.posted": [
    { occurredAt, paymentId: "pay_1", kunnr: "0000012345", fiDocumentNumber: "1400000123" },
  ],
  "credit.increase.requested": [
    {
      occurredAt,
      requestId: "req_1",
      kunnr: "0000012345",
      requestedLimit: 750000,
      currentLimit: 500000,
    },
  ],
  "credit.increase.decided": [
    {
      occurredAt,
      requestId: "req_1",
      kunnr: "0000012345",
      decision: "approved",
      approvedLimit: 600000,
    },
    { occurredAt, requestId: "req_1", kunnr: "0000012345", decision: "rejected" },
  ],
  "support.ticket.created": [
    {
      occurredAt,
      ticketId: "tkt_1",
      ticketNo: "TKT-000042",
      kunnr: "0000012345",
      category: "billing",
      priority: "medium",
      subject: "Invoice mismatch",
    },
  ],
  "support.ticket.resolved": [
    { occurredAt, ticketId: "tkt_1", ticketNo: "TKT-000042", kunnr: "0000012345" },
  ],
  "support.sla.breached": [
    {
      occurredAt,
      ticketId: "tkt_1",
      ticketNo: "TKT-000042",
      kunnr: "0000012345",
      priority: "high",
      deadline: new Date("2026-07-20T05:00:00.000Z"),
    },
  ],
};
