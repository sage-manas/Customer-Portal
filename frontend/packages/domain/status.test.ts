import { describe, expect, it } from "vitest";

import {
  CANONICAL_STATUSES,
  mapDeliveryWbstkToStatus,
  mapOnboardingStatusToCanonical,
  mapOrderCmgstToStatus,
  mapOrderGbstkToStatus,
  mapPresalesGbstkToStatus,
  statusBadgeVariant,
} from "./status";

/**
 * Pins the raw-SAP-code -> CanonicalStatus mappers (REMEDIATION-PLAN §7
 * Tier 1: "the status registries"). These are the only place a GBSTK/CMGST/
 * WBSTK code is translated, so a wrong mapping here is a wrong badge on
 * every order, delivery and quotation screen.
 */
describe("statusBadgeVariant", () => {
  it("has a variant for every canonical status", () => {
    for (const status of CANONICAL_STATUSES) {
      expect(statusBadgeVariant[status]).toBeDefined();
    }
  });
});

describe("mapOrderGbstkToStatus", () => {
  it("maps A/B/C to Open/PartiallyDelivered/Closed", () => {
    expect(mapOrderGbstkToStatus("A")).toBe("Open");
    expect(mapOrderGbstkToStatus("B")).toBe("PartiallyDelivered");
    expect(mapOrderGbstkToStatus("C")).toBe("Closed");
  });
});

describe("mapOrderCmgstToStatus", () => {
  it("maps A/B/C to Open/CreditHold/Confirmed", () => {
    expect(mapOrderCmgstToStatus("A")).toBe("Open");
    expect(mapOrderCmgstToStatus("B")).toBe("CreditHold");
    expect(mapOrderCmgstToStatus("C")).toBe("Confirmed");
  });
});

describe("mapPresalesGbstkToStatus", () => {
  it("maps the same GBSTK code differently to an order, since B here is not a shipment", () => {
    expect(mapPresalesGbstkToStatus("A")).toBe("Open");
    expect(mapPresalesGbstkToStatus("B")).toBe("InProcess");
    expect(mapPresalesGbstkToStatus("C")).toBe("Closed");
  });

  it("diverges from mapOrderGbstkToStatus on B specifically", () => {
    expect(mapPresalesGbstkToStatus("B")).not.toBe(mapOrderGbstkToStatus("B"));
  });
});

describe("mapDeliveryWbstkToStatus", () => {
  it("maps C to Delivered and B to PartiallyDelivered regardless of events", () => {
    expect(mapDeliveryWbstkToStatus("C")).toBe("Delivered");
    expect(mapDeliveryWbstkToStatus("B")).toBe("PartiallyDelivered");
  });

  it("is Open at A with no warehouse confirmations yet", () => {
    expect(mapDeliveryWbstkToStatus("A")).toBe("Open");
    expect(mapDeliveryWbstkToStatus("A", {})).toBe("Open");
  });

  it("steps through Picked -> Packed -> InTransit as confirmations arrive at A", () => {
    expect(mapDeliveryWbstkToStatus("A", { picked: true })).toBe("Picked");
    expect(mapDeliveryWbstkToStatus("A", { picked: true, packed: true })).toBe("Packed");
    expect(
      mapDeliveryWbstkToStatus("A", { picked: true, packed: true, goodsIssued: true }),
    ).toBe("InTransit");
  });

  it("prioritises the most-advanced confirmation when events disagree", () => {
    // goodsIssued without packed/picked set still means it shipped.
    expect(mapDeliveryWbstkToStatus("A", { goodsIssued: true })).toBe("InTransit");
    expect(mapDeliveryWbstkToStatus("A", { packed: true })).toBe("Packed");
  });
});

describe("mapOnboardingStatusToCanonical", () => {
  it("passes each onboarding status through unchanged", () => {
    for (const status of ["Draft", "Submitted", "PendingApproval", "Approved", "Rejected"] as const) {
      expect(mapOnboardingStatusToCanonical(status)).toBe(status);
    }
  });
});
