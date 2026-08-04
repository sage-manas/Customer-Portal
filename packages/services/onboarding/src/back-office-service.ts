import type { GstnAdapter } from "@cc/adapter-gstn";
import type { SapAdapter } from "@cc/adapter-sap";
import { db, getTenantId, runWithTenant } from "@cc/db";
import type { GstinVerification, OnboardingApplication, OnboardingDocumentKind } from "@cc/domain";

import { toApplication } from "./mapping";
import {
  approveApplication,
  getApplicationCore,
  removeDocumentCore,
  saveStepCore,
  startApplicationCore,
  submitApplicationCore,
  uploadDocumentCore,
  verifyApplicationGstinCore,
  type ApprovalResult,
  type UploadDocumentInput,
} from "./onboarding-service";

/**
 * Back-office registration — "Register Customer" at `/admin/customers/new`
 * (doc 09 §3.4, ADR-056).
 *
 * This is the **second entry point to one flow**, not a second flow. Every
 * function below is a thin wrapper over the same implementation the public
 * wizard uses, with one thing changed: the credential. The applicant holds
 * an unguessable draft token because they have no session (ADR-009); a
 * tenant admin holds a session the route has already checked for
 * `customer:register`, so their access is `{ kind: "back_office" }` and the
 * row they may reach is one the back office started.
 *
 * Separate file, separate exports — the pattern ADR-032 established for the
 * customer plane and the sales desk. The security property it buys is the
 * same: no argument can be dropped to turn one plane's call into the
 * other's, because the entry points do not share a signature.
 *
 * The one *behavioural* difference is the review gate, and it is deliberate:
 * `registerCustomer` submits and approves in one call, because the initiator
 * is the approver. A queue that a client admin files into and then approves
 * themselves would record the same fact with two extra clicks and one more
 * chance to leave a customer half-registered. `initiatedByUserId` on the
 * application and `decidedByUserId` from the approval both point at that
 * admin, so the trail says exactly what happened.
 */

export interface StartBackOfficeRegistrationResult {
  application: OnboardingApplication;
}

/**
 * Starts a registration the tenant fills in on the customer's behalf.
 *
 * The draft token minted underneath is deliberately not returned: nobody
 * outside the back office should be able to reach this application, and a
 * token nobody has is the simplest way to say so.
 */
export async function startBackOfficeRegistration(
  tenantId: string,
  actorUserId: string,
): Promise<StartBackOfficeRegistrationResult> {
  const { application } = await startApplicationCore(tenantId, {
    initiatedByUserId: actorUserId,
  });
  return { application };
}

export async function getBackOfficeRegistration(
  tenantId: string,
  applicationId: string,
): Promise<OnboardingApplication> {
  return getApplicationCore(tenantId, applicationId, { kind: "back_office" });
}

export async function saveBackOfficeStep(
  tenantId: string,
  applicationId: string,
  step: number,
  values: Record<string, unknown>,
): Promise<OnboardingApplication> {
  return saveStepCore(tenantId, applicationId, { kind: "back_office" }, step, values);
}

export async function verifyBackOfficeGstin(
  tenantId: string,
  applicationId: string,
  gstn: GstnAdapter,
): Promise<GstinVerification> {
  return verifyApplicationGstinCore(tenantId, applicationId, { kind: "back_office" }, gstn);
}

export async function uploadBackOfficeDocument(
  tenantId: string,
  applicationId: string,
  input: UploadDocumentInput,
): Promise<OnboardingApplication> {
  return uploadDocumentCore(tenantId, applicationId, { kind: "back_office" }, input);
}

export async function removeBackOfficeDocument(
  tenantId: string,
  applicationId: string,
  kind: OnboardingDocumentKind,
): Promise<OnboardingApplication> {
  return removeDocumentCore(tenantId, applicationId, { kind: "back_office" }, kind);
}

export interface RegisterCustomerDecision {
  salesOrg: string;
  distributionChannel: string;
  creditApprovalStatus?: string;
  actorUserId: string;
}

/**
 * Submit *and* approve, in that order.
 *
 * The submit half is not skipped: it is where the full-schema validation,
 * the GSTIN evidence check, the document check and the duplicate guard live,
 * and a registration that bypassed them would be a second, laxer definition
 * of a complete application. What is skipped is only the *wait* — the
 * application passes through `Submitted` and `PendingApproval` to `Approved`
 * within one call, and its event timeline shows all three, so the record
 * reads the same as any other approved customer's.
 *
 * Portal credentials are issued afterwards by the route handler, from the
 * KUNNR this returns — a service may not call another (ADR-011), which is
 * why approval and provisioning are sequenced there and not here.
 */
export async function registerCustomer(
  tenantId: string,
  applicationId: string,
  decision: RegisterCustomerDecision,
  sap: SapAdapter,
): Promise<ApprovalResult> {
  // Access is proved once, before anything is written: `submitApplicationCore`
  // 404s an application the back office did not start.
  await submitApplicationCore(tenantId, applicationId, { kind: "back_office" });

  const result = await approveApplication(tenantId, applicationId, decision, sap);

  await runWithTenant(tenantId, async () => {
    await db.auditLog.create({
      data: {
        tenantId: getTenantId(),
        actorUserId: decision.actorUserId,
        action: "onboarding.registered_by_back_office",
        entityType: "OnboardingApplication",
        entityId: applicationId,
        metadata: { kunnr: result.kunnr, selfApproved: true },
      },
    });
  });

  return result;
}

/**
 * The back-office queue's own read: registrations this tenant started and
 * has not finished. An abandoned half-filled registration is otherwise
 * invisible — the applicant-side equivalent is recoverable from the
 * browser's stored draft handle, and there is no browser here to ask.
 */
export async function listBackOfficeRegistrations(
  tenantId: string,
  actorUserId?: string,
): Promise<OnboardingApplication[]> {
  return runWithTenant(tenantId, async () => {
    const rows = await db.onboardingApplication.findMany({
      where: {
        status: "draft",
        initiatedByUserId: actorUserId ? actorUserId : { not: null },
      },
      include: { documents: { orderBy: { kind: "asc" } }, events: false },
      orderBy: { updatedAt: "desc" },
      take: 25,
    });

    // Mapped through the same function every other read uses, so the draft
    // token cannot escape through this one either.
    return rows.map((row) => toApplication(row));
  });
}
