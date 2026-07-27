import type { OnboardingApplicationInput } from "@cc/domain";
import { describe, expect, it } from "vitest";

import { toCanonicalCustomer } from "./to-canonical-customer";

const DATA = {
  legalEntityName: "Vertex Polymers Private Limited",
  tradeName: "Vertex",
  customerType: "Z002",
  street: "Plot 14, MIDC Industrial Area",
  city: "Pune",
  state: "27",
  pinCode: "411018",
  country: "IN",
  contactPerson: "Rhea Kulkarni",
  email: "rhea@vertexpolymers.example",
  phone: "9820098200",
  pan: "AAPFU0939F",
  gstin: "27AAPFU0939F1ZV",
  gstRegistrationType: "01",
  paymentTermsRequested: "NT30",
} as unknown as OnboardingApplicationInput;

const ASSIGNMENT = { salesOrg: "1000", distributionChannel: "10" };

describe("toCanonicalCustomer", () => {
  it("reshapes application data into the driver-neutral customer", () => {
    expect(toCanonicalCustomer(DATA, ASSIGNMENT)).toEqual({
      legalEntityName: "Vertex Polymers Private Limited",
      tradeName: "Vertex",
      customerType: "Z002",
      address: {
        street: "Plot 14, MIDC Industrial Area",
        city: "Pune",
        region: "27",
        postalCode: "411018",
        country: "IN",
      },
      contact: {
        contactPerson: "Rhea Kulkarni",
        email: "rhea@vertexpolymers.example",
        phone: "9820098200",
      },
      tax: {
        pan: "AAPFU0939F",
        gstin: "27AAPFU0939F1ZV",
        gstRegistrationType: "01",
        cin: undefined,
        tan: undefined,
        udyam: undefined,
      },
      salesOrg: "1000",
      distributionChannel: "10",
      paymentTerms: "NT30",
    });
  });

  it("carries the state code through as KNA1-REGIO, which is what drives place of supply", () => {
    expect(toCanonicalCustomer(DATA, ASSIGNMENT).address.region).toBe("27");
  });

  it("drops blanks rather than sending empty strings to SAP", () => {
    const customer = toCanonicalCustomer(
      { ...DATA, tradeName: "", cin: "" } as unknown as OnboardingApplicationInput,
      ASSIGNMENT,
    );
    expect(customer.tradeName).toBeUndefined();
    expect(customer.tax.cin).toBeUndefined();
  });

  it("takes sales org and channel from the reviewer's decision, never from applicant input", () => {
    const customer = toCanonicalCustomer(
      {
        ...DATA,
        salesOrg: "9999",
        distributionChannel: "99",
      } as unknown as OnboardingApplicationInput,
      ASSIGNMENT,
    );
    expect(customer.salesOrg).toBe("1000");
    expect(customer.distributionChannel).toBe("10");
  });
});
