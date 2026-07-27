import { describe, expect, it } from "vitest";

import { fromDbStatus, toApplication, toDbStatus, type ApplicationRow } from "./mapping";

const ROW: ApplicationRow = {
  id: "app-1",
  tenantId: "tenant-1",
  status: "pending_approval",
  data: { legalEntityName: "Vertex Polymers Private Limited", gstin: "27AAPFU0939F1ZV" },
  gstinVerification: {
    gstin: "27AAPFU0939F1ZV",
    outcome: "verified",
    verified: true,
    legalName: "Vertex Polymers Private Limited",
    checkedAt: "2026-07-27T10:00:00.000Z",
  },
  salesOrg: null,
  distributionChannel: null,
  creditApprovalStatus: null,
  sapCustomerCode: null,
  rejectionReasons: [],
  reviewNote: null,
  submittedAt: new Date("2026-07-27T09:00:00.000Z"),
  decidedAt: null,
  documents: [
    {
      kind: "panCardCopy",
      storageKey: "tenant-1/onboarding/app-1/panCardCopy.pdf",
      fileName: "pan.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      uploadedAt: new Date("2026-07-27T08:00:00.000Z"),
    },
  ],
  events: [
    { status: "draft", note: null, createdAt: new Date("2026-07-27T07:00:00.000Z") },
    { status: "submitted", note: null, createdAt: new Date("2026-07-27T09:00:00.000Z") },
  ],
};

describe("status translation", () => {
  it("round-trips every canonical status through the storage enum", () => {
    for (const status of [
      "Draft",
      "Submitted",
      "PendingApproval",
      "Approved",
      "Rejected",
    ] as const) {
      expect(fromDbStatus(toDbStatus(status))).toBe(status);
    }
  });
});

describe("toApplication", () => {
  it("maps a row to the canonical entity", () => {
    const application = toApplication(ROW);

    expect(application.status).toBe("PendingApproval");
    expect(application.data.legalEntityName).toBe("Vertex Polymers Private Limited");
    expect(application.gstinVerification?.verified).toBe(true);
    expect(application.documents[0]).toMatchObject({ kind: "panCardCopy", fileName: "pan.pdf" });
    expect(application.events.map((e) => e.status)).toEqual(["Draft", "Submitted"]);
  });

  it("never carries the draft token — a reviewer's screen must not leak it", () => {
    const application = toApplication({ ...ROW, ...{ draftToken: "secret" } } as ApplicationRow);
    expect(JSON.stringify(application)).not.toContain("secret");
  });

  it("tolerates a half-filled draft rather than throwing on it", () => {
    const application = toApplication({
      ...ROW,
      status: "draft",
      data: null,
      gstinVerification: { nonsense: true },
      documents: undefined,
      events: undefined,
    });

    expect(application.data).toEqual({});
    expect(application.gstinVerification).toBeUndefined();
    expect(application.documents).toEqual([]);
    expect(application.events).toEqual([]);
  });

  it("normalizes empty rejection reasons to undefined", () => {
    expect(toApplication(ROW).rejectionReasons).toBeUndefined();
    expect(
      toApplication({ ...ROW, rejectionReasons: ["No GST certificate"] }).rejectionReasons,
    ).toEqual(["No GST certificate"]);
  });
});
