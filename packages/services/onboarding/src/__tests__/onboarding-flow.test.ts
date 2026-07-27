import { randomUUID } from "node:crypto";

import { MockGstnAdapter } from "@cc/adapter-gstn";
import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { OnboardingError } from "../errors";
import {
  approveApplication,
  getApplicationForReview,
  getDraftApplication,
  listApplications,
  readDocument,
  rejectApplication,
  removeDocument,
  requestMoreInfo,
  saveStep,
  startApplication,
  submitApplication,
  uploadDocument,
  verifyApplicationGstin,
  type DraftHandle,
} from "../onboarding-service";

/**
 * The Phase 2 vertical, end to end against a real database and the mock
 * GSTN/SAP/storage drivers: registry-derived validation -> service ->
 * adapter -> stored decision. Requires Postgres (see the package README).
 */

const REVIEWER = "reviewer-user-id";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const STEP_1 = {
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

const STEP_2 = { pan: "AAPFU0939F", gstin: "27AAPFU0939F1ZV", gstRegistrationType: "01" };
const STEP_3 = { requestedCreditLimit: 500000 };

const gstn = new MockGstnAdapter();

function sap() {
  // A fresh mock per approval: it mutates its own store, and a shared one
  // would make the duplicate-GSTIN case order-dependent.
  return new MockSapAdapter();
}

describe("onboarding flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `onb-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `onb-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.onboardingEvent.deleteMany();
        await db.onboardingDocument.deleteMany();
        await db.onboardingApplication.deleteMany();
        await db.auditLog.deleteMany();
      });
    }
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await runWithTenant(tenantA.id, async () => {
      await db.onboardingEvent.deleteMany();
      await db.onboardingDocument.deleteMany();
      await db.onboardingApplication.deleteMany();
    });
  });

  /** Walks a fresh application up to (but not through) submission. */
  async function completedDraft(tenantId = tenantA.id): Promise<DraftHandle> {
    const { application, draftToken } = await startApplication(tenantId);
    const handle = { applicationId: application.id, draftToken };

    await saveStep(tenantId, handle, 1, STEP_1);
    await saveStep(tenantId, handle, 2, STEP_2);
    await saveStep(tenantId, handle, 3, STEP_3);
    await verifyApplicationGstin(tenantId, handle, gstn);

    for (const kind of ["panCardCopy", "gstCertificate"] as const) {
      await uploadDocument(tenantId, handle, {
        kind,
        fileName: `${kind}.pdf`,
        contentType: "application/pdf",
        body: PDF,
      });
    }

    return handle;
  }

  describe("draft access", () => {
    it("starts a draft and returns its token exactly once", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);

      expect(application.status).toBe("Draft");
      expect(draftToken).toHaveLength(43);
      expect(JSON.stringify(application)).not.toContain(draftToken);
    });

    it("refuses a wrong draft token as not found, not forbidden", async () => {
      const { application } = await startApplication(tenantA.id);
      const error = await getDraftApplication(tenantA.id, {
        applicationId: application.id,
        draftToken: "wrong-token",
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OnboardingError);
      expect(error).toMatchObject({ code: "not_found", status: 404 });
    });

    it("does not reveal another tenant's application, even with the right token", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);

      await expect(
        getDraftApplication(tenantB.id, { applicationId: application.id, draftToken }),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    });
  });

  describe("saving steps", () => {
    it("persists a valid step and normalizes statutory identifiers", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };

      await saveStep(tenantA.id, handle, 1, STEP_1);
      const saved = await saveStep(tenantA.id, handle, 2, {
        ...STEP_2,
        pan: " aapfu0939f ",
        gstin: "27aapfu0939f1zv",
      });

      expect(saved.data.pan).toBe("AAPFU0939F");
      expect(saved.data.gstin).toBe("27AAPFU0939F1ZV");
      expect(saved.data.legalEntityName).toBe("Vertex Polymers Private Limited");
    });

    it("rejects a step whose fields fail the registry-derived rules", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const error = await saveStep(tenantA.id, { applicationId: application.id, draftToken }, 1, {
        ...STEP_1,
        pinCode: "41101",
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "invalid", status: 422 });
      expect((error as OnboardingError).issues).toContainEqual(
        expect.objectContaining({ field: "pinCode" }),
      );
    });

    it("applies cross-field rules against the merged draft", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, { ...STEP_1, state: "29" });

      const error = await saveStep(tenantA.id, handle, 2, STEP_2).catch((e: unknown) => e);

      expect((error as OnboardingError).issues[0]?.message).toContain(
        "doesn't match your billing state",
      );
    });

    it("discards GSTN evidence when the GSTIN changes", async () => {
      const handle = await completedDraft();
      expect((await getDraftApplication(tenantA.id, handle)).gstinVerification?.verified).toBe(
        true,
      );

      // Same state, so only the number changes — this is about evidence, not
      // about the cross-field rule.
      const updated = await saveStep(tenantA.id, handle, 2, {
        ...STEP_2,
        pan: "AAECV1234Q",
        gstin: "27AAECV1234Q1ZY",
      });
      expect(updated.gstinVerification).toBeUndefined();
    });
  });

  describe("GSTIN verification", () => {
    it("records evidence for an active registration", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, STEP_1);
      await saveStep(tenantA.id, handle, 2, STEP_2);

      const verification = await verifyApplicationGstin(tenantA.id, handle, gstn);

      expect(verification).toMatchObject({
        outcome: "verified",
        verified: true,
        legalName: "Vertex Polymers Private Limited",
        stateCode: "27",
      });
      expect((await getDraftApplication(tenantA.id, handle)).gstinVerification?.checkedAt).toBe(
        verification.checkedAt,
      );
    });

    it("reports a cancelled registration as inactive rather than throwing", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, { ...STEP_1, state: "24" });
      await saveStep(tenantA.id, handle, 2, {
        ...STEP_2,
        pan: "AAACC1206D",
        gstin: "24AAACC1206D1ZM",
      });

      const verification = await verifyApplicationGstin(tenantA.id, handle, gstn);

      expect(verification).toMatchObject({ outcome: "inactive", verified: false });
      expect(verification.message).toContain("cancelled");
    });

    it("does not block the applicant when GSTN itself is unreachable", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, STEP_1);
      await saveStep(tenantA.id, handle, 2, STEP_2);

      const verification = await verifyApplicationGstin(
        tenantA.id,
        handle,
        new MockGstnAdapter({ unavailable: true }),
      );

      expect(verification).toMatchObject({ outcome: "unavailable", verified: false });
    });

    it("refuses to verify before a GSTIN has been entered", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      await expect(
        verifyApplicationGstin(tenantA.id, { applicationId: application.id, draftToken }, gstn),
      ).rejects.toMatchObject({ code: "invalid" });
    });
  });

  describe("documents", () => {
    it("stores an upload and reads it back", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };

      const updated = await uploadDocument(tenantA.id, handle, {
        kind: "panCardCopy",
        fileName: "pan card.pdf",
        contentType: "application/pdf",
        body: PDF,
      });

      expect(updated.documents).toHaveLength(1);
      expect(updated.documents[0]?.storageKey).toContain(`${tenantA.id}/onboarding/`);

      const file = await readDocument(tenantA.id, application.id, "panCardCopy");
      expect(file.body).toEqual(PDF);
      expect(file.fileName).toBe("pan card.pdf");
    });

    it("replaces rather than accumulates when the same kind is re-uploaded", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      const upload = { kind: "panCardCopy" as const, contentType: "application/pdf", body: PDF };

      await uploadDocument(tenantA.id, handle, { ...upload, fileName: "first.pdf" });
      const updated = await uploadDocument(tenantA.id, handle, {
        ...upload,
        fileName: "second.pdf",
      });

      expect(updated.documents).toHaveLength(1);
      expect(updated.documents[0]?.fileName).toBe("second.pdf");
    });

    it("rejects a disallowed file type with an inline issue on that field", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const error = await uploadDocument(
        tenantA.id,
        { applicationId: application.id, draftToken },
        { kind: "panCardCopy", fileName: "scan.zip", contentType: "application/zip", body: PDF },
      ).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "invalid" });
      expect((error as OnboardingError).issues[0]?.field).toBe("panCardCopy");
    });

    it("removes a document", async () => {
      const handle = await completedDraft();
      const updated = await removeDocument(tenantA.id, handle, "panCardCopy");
      expect(updated.documents.map((d) => d.kind)).toEqual(["gstCertificate"]);
    });

    it("won't serve another tenant's document", async () => {
      const handle = await completedDraft();
      await expect(
        readDocument(tenantB.id, handle.applicationId, "panCardCopy"),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("submission", () => {
    it("moves a complete application into the review queue", async () => {
      const handle = await completedDraft();
      const submitted = await submitApplication(tenantA.id, handle);

      expect(submitted.status).toBe("PendingApproval");
      expect(submitted.submittedAt).toBeInstanceOf(Date);
      // The applicant's timeline shows both hops (docs/05 §7.1).
      expect(submitted.events.map((e) => e.status)).toEqual([
        "Draft",
        "Submitted",
        "PendingApproval",
      ]);
    });

    it("refuses an application that is missing a mandatory document", async () => {
      const handle = await completedDraft();
      await removeDocument(tenantA.id, handle, "gstCertificate");

      const error = await submitApplication(tenantA.id, handle).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "incomplete", status: 422 });
      expect((error as OnboardingError).issues[0]?.field).toBe("gstCertificate");
    });

    it("refuses an application whose GSTIN was never verified", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, STEP_1);
      await saveStep(tenantA.id, handle, 2, STEP_2);
      await saveStep(tenantA.id, handle, 3, STEP_3);
      for (const kind of ["panCardCopy", "gstCertificate"] as const) {
        await uploadDocument(tenantA.id, handle, {
          kind,
          fileName: `${kind}.pdf`,
          contentType: "application/pdf",
          body: PDF,
        });
      }

      await expect(submitApplication(tenantA.id, handle)).rejects.toMatchObject({
        code: "incomplete",
      });
    });

    it("refuses a GSTIN that GSTN says doesn't exist", async () => {
      const { application, draftToken } = await startApplication(tenantA.id);
      const handle = { applicationId: application.id, draftToken };
      await saveStep(tenantA.id, handle, 1, { ...STEP_1, state: "33" });
      await saveStep(tenantA.id, handle, 2, {
        ...STEP_2,
        pan: "AAECS5678K",
        gstin: "33AAECS5678K1ZW",
      });
      await saveStep(tenantA.id, handle, 3, STEP_3);
      for (const kind of ["panCardCopy", "gstCertificate"] as const) {
        await uploadDocument(tenantA.id, handle, {
          kind,
          fileName: `${kind}.pdf`,
          contentType: "application/pdf",
          body: PDF,
        });
      }
      await verifyApplicationGstin(tenantA.id, handle, gstn);

      await expect(submitApplication(tenantA.id, handle)).rejects.toMatchObject({
        code: "incomplete",
      });
    });

    it("guards against the same GSTIN being registered twice", async () => {
      await submitApplication(tenantA.id, await completedDraft());
      const second = await completedDraft();

      await expect(submitApplication(tenantA.id, second)).rejects.toMatchObject({
        code: "duplicate",
        status: 409,
      });
    });

    it("lets a different tenant register the same GSTIN — they are different landscapes", async () => {
      await submitApplication(tenantA.id, await completedDraft());
      const forB = await completedDraft(tenantB.id);

      const submitted = await submitApplication(tenantB.id, forB);
      expect(submitted.status).toBe("PendingApproval");

      await runWithTenant(tenantB.id, async () => {
        await db.onboardingEvent.deleteMany();
        await db.onboardingDocument.deleteMany();
        await db.onboardingApplication.deleteMany();
      });
    });

    it("locks the wizard once submitted", async () => {
      const handle = await completedDraft();
      await submitApplication(tenantA.id, handle);

      await expect(saveStep(tenantA.id, handle, 1, STEP_1)).rejects.toMatchObject({
        code: "invalid_transition",
        status: 409,
      });
      await expect(submitApplication(tenantA.id, handle)).rejects.toMatchObject({
        code: "invalid_transition",
      });
    });
  });

  describe("back-office queue", () => {
    it("lists applications with the summary the queue renders", async () => {
      const handle = await completedDraft();
      await submitApplication(tenantA.id, handle);

      const [summary] = await listApplications(tenantA.id, { status: "PendingApproval" });

      expect(summary).toMatchObject({
        legalEntityName: "Vertex Polymers Private Limited",
        gstin: "27AAPFU0939F1ZV",
        gstinVerified: true,
        documentCount: 2,
        status: "PendingApproval",
      });
    });

    it("searches by legal name, GSTIN or email", async () => {
      await submitApplication(tenantA.id, await completedDraft());

      expect(await listApplications(tenantA.id, { search: "vertex" })).toHaveLength(1);
      expect(await listApplications(tenantA.id, { search: "27AAPFU" })).toHaveLength(1);
      expect(await listApplications(tenantA.id, { search: "rhea@" })).toHaveLength(1);
      expect(await listApplications(tenantA.id, { search: "globex" })).toHaveLength(0);
    });

    it("never shows another tenant's queue", async () => {
      await submitApplication(tenantA.id, await completedDraft());
      expect(await listApplications(tenantB.id)).toHaveLength(0);
    });

    it("404s a review lookup across tenants", async () => {
      const handle = await completedDraft();
      await expect(getApplicationForReview(tenantB.id, handle.applicationId)).rejects.toMatchObject(
        { code: "not_found", status: 404 },
      );
    });
  });

  describe("decisions", () => {
    async function pending(): Promise<DraftHandle> {
      const handle = await completedDraft();
      await submitApplication(tenantA.id, handle);
      return handle;
    }

    it("creates the customer in SAP on approval and syncs the code back", async () => {
      const handle = await pending();

      const result = await approveApplication(
        tenantA.id,
        handle.applicationId,
        {
          salesOrg: "1000",
          distributionChannel: "10",
          creditApprovalStatus: "01",
          actorUserId: REVIEWER,
        },
        sap(),
      );

      expect(result.kunnr).toMatch(/^\d{10}$/);
      expect(result.contactEmail).toBe("rhea@vertexpolymers.example");
      expect(result.application).toMatchObject({
        status: "Approved",
        sapCustomerCode: result.kunnr,
        salesOrg: "1000",
        distributionChannel: "10",
      });
      expect(result.application.decidedAt).toBeInstanceOf(Date);
    });

    it("writes an audit entry for the approval", async () => {
      const handle = await pending();
      await approveApplication(
        tenantA.id,
        handle.applicationId,
        { salesOrg: "1000", distributionChannel: "10", actorUserId: REVIEWER },
        sap(),
      );

      const entries = await runWithTenant(tenantA.id, () =>
        db.auditLog.findMany({ where: { entityId: handle.applicationId } }),
      );
      expect(entries.map((entry) => entry.action)).toContain("onboarding.approved");
      expect(entries.find((entry) => entry.action === "onboarding.approved")?.actorUserId).toBe(
        REVIEWER,
      );
    });

    it("requires the sales org and distribution channel the pricing procedure depends on", async () => {
      const handle = await pending();
      await expect(
        approveApplication(
          tenantA.id,
          handle.applicationId,
          { salesOrg: "", distributionChannel: "", actorUserId: REVIEWER },
          sap(),
        ),
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("surfaces a SAP rejection without leaking the raw message to the applicant", async () => {
      const handle = await pending();
      const adapter = sap();
      // Seed SAP with the same GSTIN first, so the create hits its dupe check.
      await approveApplication(
        tenantA.id,
        handle.applicationId,
        { salesOrg: "1000", distributionChannel: "10", actorUserId: REVIEWER },
        adapter,
      );

      const second = await completedDraft(tenantB.id);
      await submitApplication(tenantB.id, second);
      const error = await approveApplication(
        tenantB.id,
        second.applicationId,
        { salesOrg: "1000", distributionChannel: "10", actorUserId: REVIEWER },
        adapter,
      ).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "sap_rejected", status: 422 });
      expect((error as OnboardingError).upstreamMessage).toContain("already exists");
      expect((error as OnboardingError).message).not.toContain("KUNNR");

      // The rejected application must still be reviewable, not half-approved.
      expect((await getApplicationForReview(tenantB.id, second.applicationId)).status).toBe(
        "PendingApproval",
      );

      await runWithTenant(tenantB.id, async () => {
        await db.onboardingEvent.deleteMany();
        await db.onboardingDocument.deleteMany();
        await db.onboardingApplication.deleteMany();
      });
    });

    it("degrades to a retryable error when SAP is unreachable", async () => {
      const handle = await pending();
      await expect(
        approveApplication(
          tenantA.id,
          handle.applicationId,
          { salesOrg: "1000", distributionChannel: "10", actorUserId: REVIEWER },
          new MockSapAdapter({ unavailable: true }),
        ),
      ).rejects.toMatchObject({ code: "upstream_unavailable", status: 503 });
    });

    it("sends an application back to the applicant with Request More Info", async () => {
      const handle = await pending();

      const updated = await requestMoreInfo(tenantA.id, handle.applicationId, {
        note: "The GST certificate is unreadable — please re-upload it.",
        actorUserId: REVIEWER,
      });

      expect(updated.status).toBe("Draft");
      expect(updated.reviewNote).toContain("unreadable");
      expect(updated.submittedAt).toBeUndefined();
      // ...and the applicant can edit again with the same token.
      await expect(saveStep(tenantA.id, handle, 1, STEP_1)).resolves.toMatchObject({
        status: "Draft",
      });
    });

    it("requires a reason to reject", async () => {
      const handle = await pending();
      await expect(
        rejectApplication(tenantA.id, handle.applicationId, {
          reasons: ["  "],
          actorUserId: REVIEWER,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("records rejection reasons on the application", async () => {
      const handle = await pending();
      const updated = await rejectApplication(tenantA.id, handle.applicationId, {
        reasons: ["GSTIN belongs to a different entity"],
        actorUserId: REVIEWER,
      });

      expect(updated.status).toBe("Rejected");
      expect(updated.rejectionReasons).toEqual(["GSTIN belongs to a different entity"]);
      // Rejected is not terminal: the applicant may re-apply with their data.
      await expect(saveStep(tenantA.id, handle, 1, STEP_1)).rejects.toMatchObject({
        code: "invalid_transition",
      });
    });

    it("treats an approved application as terminal", async () => {
      const handle = await pending();
      await approveApplication(
        tenantA.id,
        handle.applicationId,
        { salesOrg: "1000", distributionChannel: "10", actorUserId: REVIEWER },
        sap(),
      );

      await expect(
        rejectApplication(tenantA.id, handle.applicationId, {
          reasons: ["changed our mind"],
          actorUserId: REVIEWER,
        }),
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });

    it("won't let one tenant decide another tenant's application", async () => {
      const handle = await pending();
      await expect(
        rejectApplication(tenantB.id, handle.applicationId, {
          reasons: ["not mine"],
          actorUserId: REVIEWER,
        }),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    });
  });
});
