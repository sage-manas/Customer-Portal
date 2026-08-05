import { CUSTOMER_EDITABLE_FIELDS, customerEditSchema } from "@cc/domain";
import { describe, expect, it } from "vitest";

import { toCustomerPatch } from "./customer-service";
import { CustomerError, isCustomerError } from "./errors";

/**
 * The two things in this package that need no database: the translation
 * between the portal's field names and the canonical customer's, and the
 * error contract the admin routes map to status codes.
 *
 * Everything else here is a composition of a SAP read with a stored row, and
 * is covered by the Postgres-backed suite in `__tests__/`.
 */

const VALUES = {
  tradeName: "Acme Trading",
  street: "9 New Road",
  city: "Nashik",
  state: "27",
  pinCode: "422001",
  country: "IN",
  contactPerson: "R Sharma",
  email: "ap@acme.example",
  phone: "9876543210",
};

describe("toCustomerPatch", () => {
  it("maps the portal's names onto SAP's", () => {
    const patch = toCustomerPatch(customerEditSchema.parse(VALUES) as typeof VALUES);

    // `state` is KNA1-REGIO and `pinCode` is KNA1-PSTLZ: the pair most worth
    // a test, because swapping them is silent and wrong.
    expect(patch.address?.region).toBe("27");
    expect(patch.address?.postalCode).toBe("422001");
    expect(patch.contact?.email).toBe("ap@acme.example");
    expect(patch.tradeName).toBe("Acme Trading");
  });

  it("carries nothing outside the editable registry", () => {
    // A patch that could carry a GSTIN would make ADR-057's boundary a
    // convention rather than a shape. The type refuses it; this asserts the
    // runtime object does too, for a caller passing extra keys.
    const patch = toCustomerPatch({
      ...VALUES,
      gstin: "27AAPFU0939F1ZV",
      pan: "AAPFU0939F",
    } as typeof VALUES);

    expect(JSON.stringify(patch)).not.toContain("27AAPFU0939F1ZV");
    expect(JSON.stringify(patch)).not.toContain("AAPFU0939F");
    expect(Object.keys(patch).sort()).toEqual(["address", "contact", "tradeName"]);
  });

  it("covers every field the registry says is editable", () => {
    const patch = toCustomerPatch(VALUES);
    const written = [
      "tradeName",
      ...Object.keys(patch.address ?? {}),
      ...Object.keys(patch.contact ?? {}),
    ];
    // Same count, so a field added to the registry without a home in the
    // patch fails here rather than being silently dropped on save.
    expect(written).toHaveLength(CUSTOMER_EDITABLE_FIELDS.length);
  });
});

describe("CustomerError", () => {
  it("answers 404 for a customer this tenant does not have, and never 403", () => {
    const error = new CustomerError("not_found");
    expect(error.status).toBe(404);
    expect(isCustomerError(error)).toBe(true);
  });

  it("separates SAP being down from SAP refusing", () => {
    // A retryable outage and a business answer must not look the same to the
    // screen: one says "try again", the other says "fix this".
    expect(new CustomerError("upstream_unavailable").status).toBe(503);
    expect(new CustomerError("sap_rejected").status).toBe(422);
  });

  it("carries SAP's own words only where an admin will read them", () => {
    const error = new CustomerError("sap_rejected", {
      upstreamMessage: "E F2 018: duplicate tax number",
      issues: [{ field: "gstin", message: "Already used" }],
    });
    expect(error.upstreamMessage).toContain("F2 018");
    expect(error.issues[0]?.field).toBe("gstin");
  });
});
