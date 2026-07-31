import { describe, expect, it } from "vitest";

import { classifyOutboxException, classifyPaymentException } from "./reconciliation";

describe("classifyPaymentException", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("flags a captured payment stuck past the posting threshold", () => {
    const result = classifyPaymentException(
      {
        state: "captured",
        gatewayReference: "gw_1",
        createdAt: new Date("2026-07-30T11:00:00Z"),
        updatedAt: new Date("2026-07-30T11:40:00Z"),
      },
      now,
    );
    expect(result?.kind).toBe("payment_posting_overdue");
    expect(result?.severity).toBe("critical");
  });

  it("does not flag a captured payment that just captured", () => {
    const result = classifyPaymentException(
      {
        state: "captured",
        gatewayReference: "gw_1",
        createdAt: now,
        updatedAt: now,
      },
      now,
    );
    expect(result).toBeNull();
  });

  it("flags an initiated payment whose webhook never arrived", () => {
    const result = classifyPaymentException(
      {
        state: "initiated",
        gatewayReference: "gw_1",
        createdAt: new Date("2026-07-30T11:00:00Z"),
        updatedAt: new Date("2026-07-30T11:00:00Z"),
      },
      now,
    );
    expect(result?.kind).toBe("payment_capture_unconfirmed");
    expect(result?.severity).toBe("warning");
  });

  it("does not flag an initiated payment with no gateway attempt yet", () => {
    const result = classifyPaymentException(
      {
        state: "initiated",
        gatewayReference: null,
        createdAt: new Date("2026-07-30T11:00:00Z"),
        updatedAt: new Date("2026-07-30T11:00:00Z"),
      },
      now,
    );
    expect(result).toBeNull();
  });

  it("does not flag a posted or failed payment", () => {
    expect(
      classifyPaymentException(
        {
          state: "posted",
          gatewayReference: "gw_1",
          createdAt: new Date("2026-07-30T09:00:00Z"),
          updatedAt: new Date("2026-07-30T09:00:00Z"),
        },
        now,
      ),
    ).toBeNull();
    expect(
      classifyPaymentException(
        {
          state: "failed",
          gatewayReference: "gw_1",
          createdAt: new Date("2026-07-30T09:00:00Z"),
          updatedAt: new Date("2026-07-30T09:00:00Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});

describe("classifyOutboxException", () => {
  const now = new Date("2026-07-30T12:00:00Z");

  it("flags a failed outbox row immediately", () => {
    const result = classifyOutboxException(
      { state: "failed", occurredAt: new Date("2026-07-30T11:59:00Z") },
      now,
    );
    expect(result?.kind).toBe("outbox_event_failed");
    expect(result?.severity).toBe("critical");
    expect(result?.ageMs).toBe(60_000);
  });

  it("does not flag pending or publishing rows", () => {
    expect(classifyOutboxException({ state: "pending", occurredAt: now }, now)).toBeNull();
    expect(classifyOutboxException({ state: "publishing", occurredAt: now }, now)).toBeNull();
  });
});
