import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchEvent,
  handlersFor,
  HandlerFailures,
  registerHandler,
  registeredQueues,
  resetHandlers,
} from "./registry";

const context = { tenantId: "tenant_1", eventId: "evt_1" };

const capturedPayload = {
  occurredAt: new Date("2026-07-28T10:00:00.000Z"),
  paymentId: "pay_1",
  kunnr: "0010001001",
  amount: 1000,
  currency: "INR",
};

describe("handler registry", () => {
  beforeEach(() => resetHandlers());

  it("refuses a handler for an event that isn't in the domain registry", () => {
    // @ts-expect-error — the point of the test is the runtime guard behind the type.
    expect(() => registerHandler("payment.refunded", async () => {})).toThrow(
      /unregistered event/i,
    );
  });

  it("treats an event with no handler as a no-op, not an error", async () => {
    // A2 emits the POD discrepancy before A3 exists to consume it; a worker
    // that threw on unhandled events would make that ordering impossible.
    await expect(
      dispatchEvent("payment.captured", capturedPayload, context),
    ).resolves.toBeUndefined();
  });

  it("runs every handler registered for an event, in registration order", async () => {
    const calls: string[] = [];
    registerHandler("payment.captured", async () => void calls.push("first"));
    registerHandler("payment.captured", async () => void calls.push("second"));

    await dispatchEvent("payment.captured", capturedPayload, context);

    expect(calls).toEqual(["first", "second"]);
    expect(handlersFor("payment.captured")).toHaveLength(2);
  });

  it("passes the payload and the context through", async () => {
    const handler = vi.fn(async () => {});
    registerHandler("payment.captured", handler);

    await dispatchEvent("payment.captured", capturedPayload, context);

    expect(handler).toHaveBeenCalledWith(capturedPayload, context);
  });

  it("still runs the later handlers when an earlier one throws, then fails the job", async () => {
    // A failed email must not also lose the projection — but the job as a
    // whole still has to fail so BullMQ retries it (ADR-023).
    const second = vi.fn(async () => {});
    registerHandler("payment.captured", async () => {
      throw new Error("smtp down");
    });
    registerHandler("payment.captured", second);

    await expect(
      dispatchEvent("payment.captured", capturedPayload, context),
    ).rejects.toBeInstanceOf(HandlerFailures);
    expect(second).toHaveBeenCalledOnce();
  });

  it("reports only the queues that actually have handlers", async () => {
    expect(registeredQueues()).toEqual([]);

    registerHandler("payment.captured", async () => {});
    expect(registeredQueues()).toEqual(["reconciliation"]);

    registerHandler("payment.posted", async () => {});
    expect(registeredQueues().sort()).toEqual(["notifications", "reconciliation"]);
  });
});
