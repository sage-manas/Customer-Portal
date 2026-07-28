import { describe, expect, it } from "vitest";

import {
  allocationTotal,
  canTransitionPayment,
  isAwaitingSapPosting,
  isPaymentSettled,
  paymentInitiateSchema,
  paymentModeLabel,
  validateAllocations,
} from "./payment";

describe("payment lifecycle", () => {
  it("allows the transitions the gateway and SAP actually cause", () => {
    expect(canTransitionPayment("initiated", "captured")).toBe(true);
    expect(canTransitionPayment("initiated", "failed")).toBe(true);
    expect(canTransitionPayment("captured", "posted")).toBe(true);
  });

  it("never fails a payment whose money was already taken", () => {
    expect(canTransitionPayment("captured", "failed")).toBe(false);
    expect(canTransitionPayment("captured", "cancelled")).toBe(false);
    expect(canTransitionPayment("posted", "failed")).toBe(false);
  });

  it("separates 'money taken' from 'settled', so a pending SAP posting is visible", () => {
    expect(isAwaitingSapPosting("captured")).toBe(true);
    expect(isPaymentSettled("captured")).toBe(false);
    expect(isPaymentSettled("posted")).toBe(true);
    expect(isPaymentSettled("failed")).toBe(true);
  });

  it("labels modes for the UI without the UI carrying the list", () => {
    expect(paymentModeLabel("upi")).toBe("UPI");
    expect(paymentModeLabel("neft")).toBe("NEFT / RTGS");
  });
});

describe("paymentInitiateSchema", () => {
  const valid = {
    mode: "upi",
    allocations: [{ documentNumber: "0090002211", amount: 100 }],
  };

  it("accepts a well-formed selection", () => {
    expect(paymentInitiateSchema.safeParse(valid).success).toBe(true);
  });

  it("requires at least one invoice", () => {
    const result = paymentInitiateSchema.safeParse({ ...valid, allocations: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown payment mode", () => {
    expect(paymentInitiateSchema.safeParse({ ...valid, mode: "cheque" }).success).toBe(false);
  });

  it("rejects a zero or negative amount", () => {
    expect(
      paymentInitiateSchema.safeParse({
        ...valid,
        allocations: [{ documentNumber: "0090002211", amount: 0 }],
      }).success,
    ).toBe(false);
  });

  it("rejects the same invoice selected twice", () => {
    const result = paymentInitiateSchema.safeParse({
      ...valid,
      allocations: [
        { documentNumber: "0090002211", amount: 50 },
        { documentNumber: "0090002211", amount: 50 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("enforces the BELNR length from the billing registry", () => {
    const result = paymentInitiateSchema.safeParse({
      ...valid,
      allocations: [{ documentNumber: "00900022110000", amount: 10 }],
    });

    expect(result.success).toBe(false);
  });
});

describe("validateAllocations", () => {
  const items = [
    { documentNumber: "A", openAmount: 100 },
    { documentNumber: "B", openAmount: 50 },
  ];

  it("accepts a partial payment", () => {
    expect(validateAllocations([{ documentNumber: "A", amount: 40 }], items)).toEqual([]);
  });

  it("accepts payment of the exact open amount", () => {
    expect(validateAllocations([{ documentNumber: "A", amount: 100 }], items)).toEqual([]);
  });

  it("refuses to overpay an item rather than posting an on-account credit", () => {
    const issues = validateAllocations([{ documentNumber: "A", amount: 100.5 }], items);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("exceeds_open_amount");
  });

  it("rejects an item that is no longer open, without saying whose it was", () => {
    const issues = validateAllocations([{ documentNumber: "Z", amount: 10 }], items);
    expect(issues[0]?.code).toBe("not_payable");
    expect(issues[0]?.message).not.toContain("Z");
  });

  it("totals what the customer will be charged", () => {
    expect(
      allocationTotal([
        { documentNumber: "A", amount: 100.15 },
        { documentNumber: "B", amount: 50.2 },
      ]),
    ).toBe(150.35);
  });
});
