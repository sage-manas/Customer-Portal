import { describe, expect, it } from "vitest";

import {
  availableTicketTransitions,
  buildTicketTimeline,
  canRateTicket,
  canReopenTicket,
  canTransitionTicket,
  formatTicketNo,
  slaBreachDue,
  slaDeadline,
  slaView,
  TICKET_CATEGORY_DEFS,
  TICKET_CATEGORY_LIST,
  TICKET_PRIORITY_LIST,
  ticketCommentSchema,
  ticketCreateSchema,
} from "./support";

const openedAt = new Date("2026-07-28T09:00:00.000Z");

describe("category and priority registries", () => {
  it("exposes every category and priority in declared order", () => {
    expect(TICKET_CATEGORY_LIST.map((c) => c.key)).toEqual([
      "delivery",
      "quality",
      "billing",
      "product",
      "general",
    ]);
    // Most urgent first — the picker reads top-down and so does the workbench sort.
    expect(TICKET_PRIORITY_LIST.map((p) => p.key)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("routes billing questions to credit, not to the support desk", () => {
    expect(TICKET_CATEGORY_DEFS.billing.routesTo).toBe("ar_manager");
    expect(TICKET_CATEGORY_DEFS.delivery.routesTo).toBe("client_admin");
  });

  it("keeps SLA windows strictly increasing as priority falls", () => {
    const hours = TICKET_PRIORITY_LIST.map((p) => p.slaHours);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
  });
});

describe("slaView", () => {
  it("puts the deadline priority-many hours after opening", () => {
    expect(slaDeadline(openedAt, "critical").toISOString()).toBe("2026-07-28T13:00:00.000Z");
    expect(slaDeadline(openedAt, "low").toISOString()).toBe("2026-07-31T09:00:00.000Z");
  });

  it("is ok while more than a quarter of the window remains", () => {
    const view = slaView(openedAt, "critical", { now: new Date("2026-07-28T11:00:00.000Z") });
    expect(view.state).toBe("ok");
    expect(view.remainingFraction).toBeCloseTo(0.5);
  });

  it("warns under 25% remaining (docs/05 §7.8 amber chip)", () => {
    expect(slaView(openedAt, "critical", { now: new Date("2026-07-28T12:15:00.000Z") }).state).toBe(
      "warning",
    );
  });

  it("breaches once the deadline passes", () => {
    const view = slaView(openedAt, "critical", { now: new Date("2026-07-28T14:00:00.000Z") });
    expect(view.state).toBe("breached");
    expect(view.remainingMs).toBeLessThan(0);
  });

  it("stops the clock at resolution, not at closure", () => {
    const view = slaView(openedAt, "critical", {
      resolvedAt: new Date("2026-07-28T10:00:00.000Z"),
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(view.state).toBe("met");
  });

  it("still reports a breach for a ticket resolved after its deadline", () => {
    // The SLA report would be worthless if finishing late retroactively
    // counted as meeting it.
    const view = slaView(openedAt, "critical", {
      resolvedAt: new Date("2026-07-28T18:00:00.000Z"),
      now: new Date("2026-07-29T00:00:00.000Z"),
    });
    expect(view.state).toBe("breached");
  });
});

describe("slaBreachDue", () => {
  const base = { openedAt, priority: "critical" as const, status: "open" as const };

  it("is due once an unresolved ticket passes its deadline", () => {
    expect(slaBreachDue(base, new Date("2026-07-28T14:00:00.000Z"))).toBe(true);
    expect(slaBreachDue(base, new Date("2026-07-28T12:00:00.000Z"))).toBe(false);
  });

  it("is never due for a ticket that has been resolved or closed", () => {
    const late = new Date("2026-07-30T00:00:00.000Z");
    expect(slaBreachDue({ ...base, resolvedAt: new Date() }, late)).toBe(false);
    expect(slaBreachDue({ ...base, status: "closed" }, late)).toBe(false);
  });
});

describe("transitions", () => {
  it("lets an agent resolve but never a customer", () => {
    expect(canTransitionTicket("in_progress", "resolved", "agent")).toBe(true);
    expect(canTransitionTicket("in_progress", "resolved", "customer")).toBe(false);
  });

  it("lets either side close or reopen", () => {
    expect(canTransitionTicket("resolved", "closed", "customer")).toBe(true);
    expect(canTransitionTicket("resolved", "open", "customer")).toBe(true);
  });

  it("refuses to resurrect a closed ticket", () => {
    expect(availableTicketTransitions("closed", "agent")).toEqual([]);
    expect(availableTicketTransitions("closed", "customer")).toEqual([]);
  });

  it("offers the customer only what they may actually do", () => {
    expect(availableTicketTransitions("open", "customer").map((t) => t.to)).toEqual(["closed"]);
  });
});

describe("canReopenTicket", () => {
  const resolvedAt = new Date("2026-07-20T09:00:00.000Z");

  it("allows a reopen inside the 7-day window", () => {
    expect(
      canReopenTicket({ status: "resolved", resolvedAt }, new Date("2026-07-26T09:00:00.000Z")),
    ).toBe(true);
  });

  it("refuses one after it", () => {
    expect(
      canReopenTicket({ status: "resolved", resolvedAt }, new Date("2026-07-28T09:00:01.000Z")),
    ).toBe(false);
  });

  it("refuses a ticket that was never resolved", () => {
    expect(canReopenTicket({ status: "open" }, new Date())).toBe(false);
  });
});

describe("buildTicketTimeline", () => {
  it("marks progress up to the current status and no further", () => {
    const stages = buildTicketTimeline({
      status: "in_progress",
      openedAt,
      startedAt: new Date("2026-07-28T10:00:00.000Z"),
    });
    expect(stages.map((s) => s.reached)).toEqual([true, true, false, false]);
    expect(stages.find((s) => s.current)?.key).toBe("in_progress");
  });

  it("renders canonical statuses, not the module's own vocabulary", () => {
    expect(buildTicketTimeline({ status: "open", openedAt }).map((s) => s.status)).toEqual([
      "Open",
      "InProcess",
      "Resolved",
      "Closed",
    ]);
  });

  it("walks a reopened ticket back to Open while keeping the old dates", () => {
    const stages = buildTicketTimeline({
      status: "open",
      openedAt,
      startedAt: new Date("2026-07-28T10:00:00.000Z"),
      resolvedAt: new Date("2026-07-28T11:00:00.000Z"),
    });
    expect(stages.map((s) => s.reached)).toEqual([true, false, false, false]);
    expect(stages[2]?.at).toEqual(new Date("2026-07-28T11:00:00.000Z"));
  });
});

describe("canRateTicket", () => {
  it("needs a resolution to rate and only accepts one rating", () => {
    expect(canRateTicket({ status: "resolved" })).toBe(true);
    expect(canRateTicket({ status: "closed" })).toBe(true);
    expect(canRateTicket({ status: "open" })).toBe(false);
    expect(canRateTicket({ status: "resolved", rating: 4 })).toBe(false);
  });
});

describe("write schemas", () => {
  const valid = {
    category: "delivery",
    priority: "high",
    subject: "Short delivery on 8000001234",
    description: "Two cartons of the ten dispatched did not arrive with the vehicle.",
  };

  it("accepts a well-formed ticket and defaults its attachments", () => {
    const parsed = ticketCreateSchema.parse(valid);
    expect(parsed.attachmentKeys).toEqual([]);
  });

  it("holds the subject to QMTXT's 40 characters", () => {
    expect(ticketCreateSchema.safeParse({ ...valid, subject: "x".repeat(41) }).success).toBe(false);
  });

  it("refuses a description too short to act on", () => {
    expect(ticketCreateSchema.safeParse({ ...valid, description: "broken" }).success).toBe(false);
  });

  it("defaults a comment to customer-visible, never internal", () => {
    expect(ticketCommentSchema.parse({ body: "any update?" }).internal).toBe(false);
  });
});

describe("formatTicketNo", () => {
  it("pads to a stable width", () => {
    expect(formatTicketNo(1)).toBe("TKT-000001");
    expect(formatTicketNo(123456)).toBe("TKT-123456");
  });
});
