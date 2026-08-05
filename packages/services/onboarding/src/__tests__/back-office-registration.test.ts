import { randomUUID } from "node:crypto";

import { MockGstnAdapter } from "@cc/adapter-gstn";
import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getBackOfficeRegistration,
  listBackOfficeRegistrations,
  registerCustomer,
  saveBackOfficeStep,
  startBackOfficeRegistration,
  uploadBackOfficeDocument,
  verifyBackOfficeGstin,
} from "../back-office-service";
import { OnboardingError } from "../errors";
import {
  getDraftApplication,
  saveStep,
  startApplication,
  type DraftHandle,
} from "../onboarding-service";

/**
 * Back-office registration (ADR-056), end to end against a real database and
 * the mock GSTN/SAP/storage drivers.
 *
 * The suite is written around the two claims the ADR makes, because those
 * are the ones that would be expensive to be wrong about: that this is the
 * *same* flow with a different credential (so the same validation refuses
 * the same things), and that the credentials do not cross — a back-office
 * session cannot drive an applicant's draft, and a draft token cannot drive
 * a back-office registration.
 */

const ADMIN = "client-admin-user-id";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

const STEP_1 = {
  legalEntityName: "Harbour Chemicals Private Limited",
  customerType: "Z002",
  street: "Plot 9, MIDC",
  city: "Pune",
  state: "27",
  pinCode: "411018",
  country: "IN",
  contactPerson: "Ira Menon",
  email: "ira@harbourchem.example",
  phone: "9820011111",
};

const STEP_2 = { pan: "AAPFU0939F", gstin: "27AAPFU0939F1ZV", gstRegistrationType: "01" };
const STEP_3 = { requestedCreditLimit: 250000 };

const DECISION = {
  salesOrg: "1000",
  distributionChannel: "10",
  actorUserId: ADMIN,
};

const gstn = new MockGstnAdapter();

/** A fresh mock per registration: it mutates its own customer store. */
function sap() {
  return new MockSapAdapter();
}

describe("back-office registration", () => {
  const runId = randomUUID().slice(0, 8);
  let tenant: { id: string };

  beforeAll(async () => {
    tenant = await db.tenant.create({ data: { slug: `bo-${runId}`, name: "Back office tenant" } });
  });

  afterAll(async () => {
    await runWithTenant(tenant.id, async () => {
      await db.onboardingEvent.deleteMany();
      await db.onboardingDocument.deleteMany();
      await db.onboardingApplication.deleteMany();
      await db.auditLog.deleteMany();
    });
    await db.tenant.deleteMany({ where: { id: tenant.id } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await runWithTenant(tenant.id, async () => {
      await db.onboardingEvent.deleteMany();
      await db.onboardingDocument.deleteMany();
      await db.onboardingApplication.deleteMany();
    });
  });

  /** Fills a back-office registration up to (but not through) creation. */
  async function completedRegistration(): Promise<string> {
    const { application } = await startBackOfficeRegistration(tenant.id, ADMIN);
    const id = application.id;

    await saveBackOfficeStep(tenant.id, id, 1, STEP_1);
    await saveBackOfficeStep(tenant.id, id, 2, STEP_2);
    await saveBackOfficeStep(tenant.id, id, 3, STEP_3);
    await verifyBackOfficeGstin(tenant.id, id, gstn);

    for (const kind of ["panCardCopy", "gstCertificate"] as const) {
      await uploadBackOfficeDocument(tenant.id, id, {
        kind,
        fileName: `${kind}.pdf`,
        contentType: "application/pdf",
        body: PDF,
      });
    }

    return id;
  }

  it("creates the customer in SAP and lands on Approved without a review step", async () => {
    const id = await completedRegistration();

    const result = await registerCustomer(tenant.id, id, DECISION, sap());

    expect(result.kunnr).toMatch(/^\d{10}$/);
    expect(result.application.status).toBe("Approved");
    expect(result.contactEmail).toBe(STEP_1.email);

    // Submitted and PendingApproval are still *recorded*: the gate is not
    // skipped as a state, only as a wait, so the timeline reads like any
    // other approved customer's (ADR-056).
    const statuses = result.application.events.map((event) => event.status);
    expect(statuses).toContain("Submitted");
    expect(statuses).toContain("PendingApproval");
    expect(statuses).toContain("Approved");
  });

  it("records who initiated it and who approved it — the same person, on purpose", async () => {
    const id = await completedRegistration();
    await registerCustomer(tenant.id, id, DECISION, sap());

    const row = await runWithTenant(tenant.id, () =>
      db.onboardingApplication.findFirstOrThrow({ where: { id } }),
    );
    expect(row.initiatedByUserId).toBe(ADMIN);
    expect(row.decidedByUserId).toBe(ADMIN);

    const audits = await runWithTenant(tenant.id, () =>
      db.auditLog.findMany({ where: { entityId: id } }),
    );
    expect(audits.map((entry) => entry.action)).toContain("onboarding.registered_by_back_office");
  });

  it("applies the same validation a public application gets", async () => {
    const { application } = await startBackOfficeRegistration(tenant.id, ADMIN);

    // The GSTIN's checksum is wrong; the registry-derived schema plus the
    // shared field rules refuse it here exactly as they do at /register.
    await expect(
      saveBackOfficeStep(tenant.id, application.id, 2, { ...STEP_2, gstin: "27AAPFU0939F1ZZ" }),
    ).rejects.toMatchObject({ code: "invalid" });

    // And an incomplete one cannot be pushed through to SAP.
    await saveBackOfficeStep(tenant.id, application.id, 1, STEP_1);
    await expect(
      registerCustomer(tenant.id, application.id, DECISION, sap()),
    ).rejects.toBeInstanceOf(OnboardingError);
  });

  it("refuses to touch an applicant's own draft, even for the back office", async () => {
    const { application, draftToken } = await startApplication(tenant.id);
    const handle: DraftHandle = { applicationId: application.id, draftToken };
    await saveStep(tenant.id, handle, 1, STEP_1);

    // 404, not 403: the back office has a queue and a Request-More-Info path
    // for this conversation; it does not get to edit somebody's statutory
    // details behind their back (ADR-056).
    await expect(getBackOfficeRegistration(tenant.id, application.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(saveBackOfficeStep(tenant.id, application.id, 1, STEP_1)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("mints a draft token nobody is given, so the token path cannot reach it", async () => {
    const { application } = await startBackOfficeRegistration(tenant.id, ADMIN);

    const row = await runWithTenant(tenant.id, () =>
      db.onboardingApplication.findFirstOrThrow({ where: { id: application.id } }),
    );
    expect(row.draftToken.length).toBeGreaterThan(20);

    // Even holding a *wrong* token behaves as it does anywhere else: the
    // applicant path is not a second door into a back-office row.
    await expect(
      getDraftApplication(tenant.id, {
        applicationId: application.id,
        draftToken: "not-the-token",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists unfinished back-office registrations and drops them once created", async () => {
    const id = await completedRegistration();

    const before = await listBackOfficeRegistrations(tenant.id, ADMIN);
    expect(before.map((application) => application.id)).toContain(id);

    await registerCustomer(tenant.id, id, DECISION, sap());

    const after = await listBackOfficeRegistrations(tenant.id, ADMIN);
    expect(after.map((application) => application.id)).not.toContain(id);
  });
});
