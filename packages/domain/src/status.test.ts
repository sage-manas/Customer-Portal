import { describe, expect, it } from "vitest";

import {
  CANONICAL_STATUSES,
  mapOrderCmgstToStatus,
  mapOrderGbstkToStatus,
  statusBadgeVariant,
} from "./status";

describe("status registry", () => {
  it("assigns a badge variant to every canonical status", () => {
    for (const status of CANONICAL_STATUSES) {
      expect(statusBadgeVariant[status]).toBeDefined();
    }
  });

  it("maps VBUK-GBSTK codes per docs/03 Screen 4.2", () => {
    expect(mapOrderGbstkToStatus("A")).toBe("Open");
    expect(mapOrderGbstkToStatus("B")).toBe("PartiallyDelivered");
    expect(mapOrderGbstkToStatus("C")).toBe("Closed");
  });

  it("maps VBUK-CMGST codes per docs/03 Screen 4.2", () => {
    expect(mapOrderCmgstToStatus("A")).toBe("Open");
    expect(mapOrderCmgstToStatus("B")).toBe("CreditHold");
    expect(mapOrderCmgstToStatus("C")).toBe("Confirmed");
  });

  it("colors credit hold as danger, matching doc 05 §3.2", () => {
    expect(statusBadgeVariant.CreditHold).toBe("danger");
  });
});
