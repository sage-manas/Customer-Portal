import { describe, expect, it } from "vitest";

import { onboardingMapping } from "../sap-mapping/onboarding";

import {
  CUSTOMER_EDITABLE_FIELDS,
  CUSTOMER_EDIT_SECTIONS,
  customerAccountBlock,
  customerAccountStatus,
  customerDeactivationSchema,
  customerEditSchema,
  customerEditableFields,
} from "./customer-account";

describe("customer account status", () => {
  it("names the two states", () => {
    expect(customerAccountStatus(true)).toBe("Active");
    expect(customerAccountStatus(false)).toBe("Deactivated");
  });

  it("gives a reason rather than a boolean when the account may not act", () => {
    expect(customerAccountBlock({ isActive: true })).toBeNull();
    expect(customerAccountBlock({ isActive: false, deactivatedAt: new Date() })).toContain(
      "deactivated",
    );
  });
});

describe("the editable-field registry", () => {
  it("resolves every name against the onboarding mapping", () => {
    // The point of the subset: labels, SAP provenance and lengths have one
    // definition, so this must never grow a field the wizard doesn't know.
    expect(customerEditableFields()).toHaveLength(CUSTOMER_EDITABLE_FIELDS.length);
    for (const field of customerEditableFields()) {
      expect(onboardingMapping).toContain(field);
    }
  });

  it("excludes the statutory identifiers and the documents", () => {
    const editable = new Set<string>(CUSTOMER_EDITABLE_FIELDS);
    for (const locked of ["pan", "gstin", "gstRegistrationType", "panCardCopy", "gstCertificate"]) {
      expect(editable.has(locked)).toBe(false);
    }
  });

  it("renders every editable field in exactly one section", () => {
    const sectioned = CUSTOMER_EDIT_SECTIONS.flatMap((section) => section.fields);
    expect([...sectioned].sort()).toEqual([...CUSTOMER_EDITABLE_FIELDS].sort());
  });
});

describe("the edit schema", () => {
  const valid = {
    tradeName: "Acme",
    street: "12 MG Road",
    city: "Pune",
    state: "27",
    pinCode: "411001",
    country: "IN",
    contactPerson: "R Sharma",
    email: "ap@acme.example",
    phone: "9876543210",
  };

  it("accepts a well-formed edit", () => {
    expect(customerEditSchema.safeParse(valid).success).toBe(true);
  });

  it("applies the same per-field rules the wizard does", () => {
    // Registry-derived length checks alone would let this through; the
    // shared field rules are what refuse it (docs/05 §6.2).
    const parsed = customerEditSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path[0] === "email")).toBe(true);
    }

    expect(customerEditSchema.safeParse({ ...valid, pinCode: "41100" }).success).toBe(false);
  });
});

describe("the deactivation schema", () => {
  it("carries the target state, so both directions are one decision (ADR-054's shape)", () => {
    expect(customerDeactivationSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(
      customerDeactivationSchema.safeParse({ isActive: false, reason: "Left the group" }).success,
    ).toBe(true);
    expect(customerDeactivationSchema.safeParse({ reason: "no state" }).success).toBe(false);
  });
});
