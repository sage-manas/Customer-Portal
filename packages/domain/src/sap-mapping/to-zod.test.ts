import { describe, expect, it } from "vitest";

import { onboardingMapping } from "./onboarding";
import { buildZodSchema, findField } from "./to-zod";

describe("buildZodSchema", () => {
  const writeSchema = buildZodSchema(onboardingMapping, "write");

  const validInput = {
    legalEntityName: "Acme Distributors Pvt Ltd",
    customerType: "DIST",
    street: "12 MG Road",
    city: "Bengaluru",
    state: "29",
    pinCode: "560001",
    country: "IN",
    contactPerson: "Priya Rao",
    email: "priya@acme.example",
    phone: "9876543210",
    pan: "AAAAA9999A",
    gstin: "29AAAAA9999A1Z5",
    gstRegistrationType: "01",
    requestedCreditLimit: 500000,
    panCardCopy: "s3://docs/pan.pdf",
    gstCertificate: "s3://docs/gst.pdf",
    salesOrg: "1000",
    distributionChannel: "10",
  };

  it("accepts a fully valid submission", () => {
    const result = writeSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects when a mandatory field is missing", () => {
    const { legalEntityName: _omit, ...withoutLegalName } = validInput;
    const result = writeSchema.safeParse(withoutLegalName);
    expect(result.success).toBe(false);
  });

  it("enforces CHAR length from the SAP field definition", () => {
    const tooLong = { ...validInput, legalEntityName: "x".repeat(36) };
    const result = writeSchema.safeParse(tooLong);
    expect(result.success).toBe(false);
  });

  it("coerces CURR fields to numbers", () => {
    const result = writeSchema.safeParse({ ...validInput, requestedCreditLimit: "500000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requestedCreditLimit).toBe(500000);
    }
  });

  it("excludes read-only (R) fields from the write schema", () => {
    expect(writeSchema.shape.sapCustomerCode).toBeUndefined();
  });

  it("read mode makes every field optional, including mandatory ones", () => {
    const readSchema = buildZodSchema(onboardingMapping, "read");
    const result = readSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("findField locates a field by portal name", () => {
    const field = findField(onboardingMapping, "gstin");
    expect(field?.sapTable).toBe("KNA1");
    expect(field?.sapField).toBe("STCD2");
  });
});
