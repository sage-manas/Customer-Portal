import { describe, expect, it } from "vitest";

import { onboardingMapping } from "../sap-mapping/onboarding";

import {
  ONBOARDING_DOCUMENT_KINDS,
  ONBOARDING_INTERNAL_FIELDS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
  canTransition,
  isOnboardingLocked,
  onboardingApplicantFields,
  onboardingCrossFieldIssues,
  onboardingStepFields,
  onboardingStepSchema,
  onboardingWriteSchema,
} from "./onboarding";

const VALID_STEP_1 = {
  legalEntityName: "Vertex Polymers Private Limited",
  customerType: "Z002",
  street: "Plot 14, MIDC Industrial Area",
  city: "Pune",
  state: "27",
  pinCode: "411018",
  country: "IN",
  contactPerson: "Rhea Kulkarni",
  email: "rhea@vertexpolymers.example",
  phone: "9820098200",
};

const VALID_STEP_2 = {
  pan: "AAPFU0939F",
  gstin: "27AAPFU0939F1ZV",
  gstRegistrationType: "01",
};

describe("step registry", () => {
  it("is the four steps doc 05 §7.1 specifies", () => {
    expect(ONBOARDING_STEP_COUNT).toBe(4);
    expect(ONBOARDING_STEPS.map((s) => s.key)).toEqual(["company", "tax", "credit", "documents"]);
  });

  it("covers every applicant field in the mapping exactly once", () => {
    const internal = new Set<string>([...ONBOARDING_INTERNAL_FIELDS]);
    const expected = onboardingMapping
      .filter((f) => f.required !== "R" && !internal.has(f.portalField))
      .map((f) => f.portalField);

    const actual = onboardingApplicantFields().map((f) => f.portalField);

    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual).toHaveLength(new Set(actual).size);
  });

  it("resolves each step's fields from the registry, not a copy of it", () => {
    const [legalEntityName] = onboardingStepFields(1);
    expect(legalEntityName).toBe(
      onboardingMapping.find((f) => f.portalField === "legalEntityName"),
    );
  });

  it("puts every document kind on the uploads step", () => {
    const step4 = onboardingStepFields(4).map((f) => f.portalField);
    expect(step4).toEqual([...ONBOARDING_DOCUMENT_KINDS]);
  });

  it("throws on an unknown step rather than rendering an empty one", () => {
    expect(() => onboardingStepFields(9)).toThrow(/Unknown onboarding step/);
  });
});

describe("step schemas", () => {
  it("accepts a well-formed step 1", () => {
    expect(onboardingStepSchema(1).safeParse(VALID_STEP_1).success).toBe(true);
  });

  it("enforces the SAP length from the registry, not a hand-written max", () => {
    const result = onboardingStepSchema(1).safeParse({
      ...VALID_STEP_1,
      legalEntityName: "x".repeat(36), // KNA1-NAME1 is CHAR 35
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["legalEntityName"]);
  });

  it("rejects a mandatory field left blank", () => {
    const { city: _city, ...withoutCity } = VALID_STEP_1;
    expect(onboardingStepSchema(1).safeParse(withoutCity).success).toBe(false);
  });

  it("applies the PAN/GSTIN domain rules on step 2", () => {
    const result = onboardingStepSchema(2).safeParse({ ...VALID_STEP_2, pan: "AAPFU0939" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain("pan");
  });

  it("does not fail step 2 for the state code it cannot see", () => {
    // Cross-field checks are the service's job on the merged draft — a step
    // schema must not reject data for a field the step doesn't render.
    expect(onboardingStepSchema(2).safeParse(VALID_STEP_2).success).toBe(true);
  });
});

describe("cross-field rules", () => {
  it("passes when GSTIN, PAN and state agree", () => {
    expect(onboardingCrossFieldIssues({ ...VALID_STEP_1, ...VALID_STEP_2 })).toEqual([]);
  });

  it("flags a GSTIN whose embedded PAN is not the PAN entered", () => {
    const issues = onboardingCrossFieldIssues({
      ...VALID_STEP_1,
      ...VALID_STEP_2,
      pan: "AAECV1234Q",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "gstin" });
    expect(issues[0]?.message).toContain("AAPFU0939F");
  });

  it("flags a GSTIN state that doesn't match the billing state", () => {
    const issues = onboardingCrossFieldIssues({
      ...VALID_STEP_1,
      ...VALID_STEP_2,
      state: "29",
      gstin: "27AAPFU0939F1ZV",
    });
    expect(issues[0]?.message).toContain("27 — Maharashtra");
    expect(issues[0]?.message).toContain("29 — Karnataka");
  });

  it("stays quiet while the GSTIN is still being typed", () => {
    expect(onboardingCrossFieldIssues({ state: "27", gstin: "27AAP" })).toEqual([]);
  });
});

describe("full submission schema", () => {
  const complete = {
    ...VALID_STEP_1,
    ...VALID_STEP_2,
    requestedCreditLimit: 500000,
    panCardCopy: "onboarding/app-1/pan.pdf",
    gstCertificate: "onboarding/app-1/gst.pdf",
  };

  it("accepts a complete application", () => {
    expect(onboardingWriteSchema.safeParse(complete).success).toBe(true);
  });

  it("rejects one that is missing a mandatory document", () => {
    const { gstCertificate: _gst, ...withoutGstCert } = complete;
    expect(onboardingWriteSchema.safeParse(withoutGstCert).success).toBe(false);
  });

  it("applies the cross-field rules on submit", () => {
    const result = onboardingWriteSchema.safeParse({ ...complete, state: "29" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === "gstin")).toBe(true);
  });
});

describe("workflow transitions", () => {
  it("allows the happy path Draft -> Submitted -> PendingApproval -> Approved", () => {
    expect(canTransition("Draft", "Submitted")).toBe(true);
    expect(canTransition("Submitted", "PendingApproval")).toBe(true);
    expect(canTransition("PendingApproval", "Approved")).toBe(true);
  });

  it("allows Request More Info to send an application back to the applicant", () => {
    expect(canTransition("PendingApproval", "Draft")).toBe(true);
  });

  it("treats Approved as terminal — a customer exists in SAP by then", () => {
    expect(canTransition("Approved", "Rejected")).toBe(false);
    expect(canTransition("Approved", "Draft")).toBe(false);
  });

  it("lets a rejected applicant re-apply with their data pre-filled", () => {
    expect(canTransition("Rejected", "Draft")).toBe(true);
  });

  it("locks editing from submission onwards", () => {
    expect(isOnboardingLocked("Draft")).toBe(false);
    expect(isOnboardingLocked("Rejected")).toBe(false);
    expect(isOnboardingLocked("Submitted")).toBe(true);
    expect(isOnboardingLocked("PendingApproval")).toBe(true);
    expect(isOnboardingLocked("Approved")).toBe(true);
  });
});
