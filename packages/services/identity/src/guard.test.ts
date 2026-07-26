import type { SessionClaims } from "@cc/domain";
import { describe, expect, it } from "vitest";

import {
  requireCustomerAccount,
  requirePermission,
  requireSession,
  resolveActiveKunnr,
} from "./guard";

const buyer: SessionClaims = {
  userId: "usr_1",
  tenantId: "tnt_1",
  tenantSlug: "acme",
  email: "buyer@acme.example",
  roles: ["buyer_user"],
  kunnr: "0010001001",
  availableKunnrs: ["0010001001", "0010001002"],
};

const viewer: SessionClaims = { ...buyer, roles: ["buyer_view_only"] };

describe("guards", () => {
  it("requires a session", () => {
    expect(() => requireSession(null)).toThrow(/session isn't valid/);
    expect(requireSession(buyer)).toBe(buyer);
  });

  it("enforces permissions at the API layer, not the UI (docs/05 §4.3)", () => {
    expect(requirePermission(buyer, "order:create")).toBe(buyer);
    expect(() => requirePermission(viewer, "order:create")).toThrow(/permission/);
    expect(() => requirePermission(buyer, "credit:release")).toThrow(/permission/);
  });

  it("blocks acting for a KUNNR the user does not hold", () => {
    expect(requireCustomerAccount(buyer, "0010001002")).toBe(buyer);
    expect(() => requireCustomerAccount(buyer, "0010009999")).toThrow(/permission/);
  });

  it("defaults the active account to the session's own KUNNR", () => {
    expect(resolveActiveKunnr(buyer)).toBe("0010001001");
    expect(resolveActiveKunnr(buyer, "0010001002")).toBe("0010001002");
    expect(() => resolveActiveKunnr(buyer, "0010009999")).toThrow();
    expect(() => resolveActiveKunnr({ ...buyer, kunnr: undefined })).toThrow();
  });
});
