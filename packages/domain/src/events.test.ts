import { describe, expect, it } from "vitest";

import {
  DOMAIN_EVENTS,
  DOMAIN_EVENT_NAMES,
  EVENT_QUEUES,
  eventQueue,
  isDomainEventName,
  parseEventPayload,
} from "./events";

describe("domain event registry", () => {
  it("routes every registered event to a declared queue", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      expect(EVENT_QUEUES).toContain(eventQueue(name));
    }
  });

  it("names every event in the past tense, because an outbox holds facts (ADR-023)", () => {
    // A command in an outbox is a request the database cannot guarantee; the
    // naming convention is the cheapest place to catch one being added.
    for (const name of DOMAIN_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+(\.[a-z]+)+ed$/);
    }
  });

  it("gives every event a description, so an ops dashboard can explain itself", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      expect(DOMAIN_EVENTS[name].description.length).toBeGreaterThan(10);
    }
  });

  it("parses a valid payload and coerces occurredAt to a Date", () => {
    const payload = parseEventPayload("payment.posted", {
      occurredAt: "2026-07-28T10:00:00.000Z",
      paymentId: "pay_1",
      kunnr: "0000001000",
      fiDocumentNumber: "1400000123",
    });

    expect(payload.occurredAt).toBeInstanceOf(Date);
    expect(payload.fiDocumentNumber).toBe("1400000123");
  });

  it("rejects a payload missing a required field at the producer, not in the worker", () => {
    expect(() =>
      parseEventPayload("payment.posted", {
        occurredAt: new Date(),
        paymentId: "pay_1",
        kunnr: "0000001000",
      }),
    ).toThrow();
  });

  it("defaults order.created to not credit-blocked rather than leaving it undefined", () => {
    const payload = parseEventPayload("order.created", {
      occurredAt: new Date(),
      kunnr: "0000001000",
      documentNumber: "0000004711",
    });

    expect(payload.creditBlocked).toBe(false);
  });

  it("recognises registered names and refuses unregistered ones", () => {
    expect(isDomainEventName("payment.captured")).toBe(true);
    expect(isDomainEventName("payment.refunded")).toBe(false);
  });
});
