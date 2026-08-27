/**
 * Frontend-only stand-in for `@cc/service-onboarding` (public
 * self-registration and the back-office review queue / registration wizard).
 *
 * Applications are portal-owned, so the whole module lives in the demo
 * store: the applicant's draft token, the step-by-step saves, the GSTIN
 * verification, the reviewer's approve/reject/request-info decisions. The
 * one thing that reaches outside is approval, which creates the customer in
 * SAP through the mock adapter — so approving an application really does
 * mint a KUNNR the rest of the demo can then read.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-onboarding: the `OnboardingApplication`
 * table, document uploads to object storage, the GSTN adapter, and portal
 * access provisioning on approval.
 */

import {
  ONBOARDING_STEP_COUNT,
  canTransition,
  type GstinVerification,
  type OnboardingApplication,
  type OnboardingApplicationInput,
  type OnboardingApplicationStatus,
  type OnboardingDocumentKind,
  type OnboardingDocumentRef,
} from "@cc/domain";

import { DemoServiceError, demoStore, nextSequence } from "./_demo";
/**
 * Migrated verbatim from client/packages/services/onboarding/src — it is
 * IO-free by design (see its own comment), so it is frontend-safe as it
 * stands and the demo approval builds exactly the customer SAP expects.
 */
import { toCanonicalCustomer } from "./to-canonical-customer";

import type { SapAdapter } from "../sap-mock";

export class OnboardingError extends DemoServiceError {
  constructor(message: string, code = "onboarding_error", status = 400) {
    super(message, { code, status });
    this.name = "OnboardingError";
  }
}

export function isOnboardingError(error: unknown): error is OnboardingError {
  return error instanceof OnboardingError;
}

export type OnboardingErrorCode = string;

interface StoredApplication extends OnboardingApplication {
  draftToken: string;
}

const applications = () => demoStore().onboardingApplications as StoredApplication[];

function strip(application: StoredApplication): OnboardingApplication {
  // The draft token is returned exactly once, at creation, and never again.
  const { draftToken: _draftToken, ...rest } = application;
  return rest;
}

function find(id: string): StoredApplication {
  const application = applications().find((row) => row.id === id);
  if (!application) {
    throw new OnboardingError("We couldn't find that application.", "not_found", 404);
  }
  return application;
}

/** The applicant proves ownership with an unguessable token (ADR-009). */
function assertDraftAccess(application: StoredApplication, draftToken: string): void {
  if (application.draftToken !== draftToken) {
    throw new OnboardingError("We couldn't find that application.", "not_found", 404);
  }
}

function transition(
  application: StoredApplication,
  to: OnboardingApplicationStatus,
  note?: string,
): void {
  if (!canTransition(application.status, to)) {
    throw new OnboardingError(
      `An application that is ${application.status} can't move to ${to}.`,
      "invalid_transition",
      409,
    );
  }
  application.status = to;
  application.events.push({ at: new Date(), status: to, note });
}

// ---------------------------------------------------------------------------
// Applicant plane
// ---------------------------------------------------------------------------

export interface DraftHandle {
  applicationId: string;
  draftToken: string;
}

export interface StartApplicationResult {
  application: OnboardingApplication;
  draftToken: string;
}

export async function startApplication(tenantId: string): Promise<StartApplicationResult> {
  const sequence = nextSequence("application");
  const application: StoredApplication = {
    id: `app-${sequence}`,
    tenantId,
    status: "Draft",
    data: {},
    documents: [],
    events: [{ at: new Date(), status: "Draft" }],
    draftToken: `draft-${sequence}-${Math.random().toString(36).slice(2, 10)}`,
  };

  applications().push(application);
  return { application: strip(application), draftToken: application.draftToken };
}

export async function getDraftApplication(
  _tenantId: string,
  handle: DraftHandle,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);
  return strip(application);
}

export async function saveStep(
  _tenantId: string,
  handle: DraftHandle,
  step: number,
  data: Partial<OnboardingApplicationInput>,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);

  if (step < 1 || step > ONBOARDING_STEP_COUNT) {
    throw new OnboardingError(`Step ${step} doesn't exist.`, "invalid_step", 422);
  }
  if (application.status !== "Draft") {
    throw new OnboardingError(
      "This application has already been submitted and can't be edited.",
      "locked",
      409,
    );
  }

  application.data = { ...application.data, ...data };
  return strip(application);
}

export async function submitApplication(
  _tenantId: string,
  handle: DraftHandle,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);

  transition(application, "Submitted");
  application.submittedAt = new Date();

  // System validation passed, so it goes straight into the review queue —
  // two events, because the applicant's timeline shows both.
  transition(application, "PendingApproval");
  return strip(application);
}

export interface UploadDocumentInput {
  kind: OnboardingDocumentKind;
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export async function uploadDocument(
  _tenantId: string,
  handle: DraftHandle,
  input: UploadDocumentInput,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);

  // TODO(BACKEND):
  // The real service streams the file into object storage
  // (@cc/adapter-storage). Demo mode records the metadata only, which is
  // enough for the wizard's uploaded-file list and the reviewer's checklist.
  const document: OnboardingDocumentRef = {
    kind: input.kind,
    storageKey: documentStorageKey(application.tenantId, application.id, input.kind),
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.body.byteLength,
    uploadedAt: new Date(),
  };

  application.documents = [
    ...application.documents.filter((row) => row.kind !== input.kind),
    document,
  ];
  return strip(application);
}

export async function removeDocument(
  _tenantId: string,
  handle: DraftHandle,
  kind: OnboardingDocumentKind,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);
  application.documents = application.documents.filter((row) => row.kind !== kind);
  return strip(application);
}

export async function readDocument(): Promise<never> {
  throw new OnboardingError(
    "Document downloads aren't available in demo mode. Backend integration pending.",
    "demo_unavailable",
    503,
  );
}

export async function verifyApplicationGstin(
  _tenantId: string,
  handle: DraftHandle,
  gstin: string,
): Promise<OnboardingApplication> {
  const application = find(handle.applicationId);
  assertDraftAccess(application, handle.draftToken);
  application.gstinVerification = demoGstinVerification(gstin, application);
  return strip(application);
}

/**
 * A deterministic stand-in for the GSTN lookup: a well-formed GSTIN whose
 * state code matches the address verifies, anything else comes back as a
 * mismatch. Enough to exercise both branches of the wizard's gate.
 *
 * TODO(BACKEND): the real check goes through @cc/adapter-gstn.
 */
function demoGstinVerification(gstin: string, application: StoredApplication): GstinVerification {
  const wellFormed = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin.toUpperCase());
  return {
    gstin,
    outcome: wellFormed ? "verified" : "invalid",
    verified: wellFormed,
    legalName: application.data.legalEntityName,
    tradeName: application.data.legalEntityName,
    stateCode: gstin.slice(0, 2),
    taxpayerStatus: wellFormed ? "Active" : undefined,
    checkedAt: new Date().toISOString(),
    message: wellFormed
      ? "GSTIN verified against the GST portal (demo mode)."
      : "That doesn't look like a valid 15-character GSTIN.",
  };
}

export function getGstnAdapterForTenant(_tenantId: string): null {
  return null;
}

export function isGstnError(_error: unknown): boolean {
  return false;
}

export type GstnAdapter = unknown;
export type GstnTaxpayer = unknown;

export function documentStorageKey(
  tenantId: string,
  applicationId: string,
  kind: string,
): string {
  return `${tenantId}/onboarding/${applicationId}/${kind}`;
}

export function getOnboardingStorage(): null {
  return null;
}

// ---------------------------------------------------------------------------
// Reviewer plane
// ---------------------------------------------------------------------------

export interface OnboardingApplicationSummary {
  id: string;
  status: OnboardingApplicationStatus;
  legalEntityName: string;
  gstin?: string;
  contactEmail?: string;
  city?: string;
  state?: string;
  gstinVerified: boolean;
  documentCount: number;
  sapCustomerCode?: string;
  submittedAt?: Date;
  createdAt: Date;
}

export interface ListApplicationsFilter {
  status?: OnboardingApplicationStatus;
  search?: string;
  limit?: number;
}

function summarize(application: StoredApplication): OnboardingApplicationSummary {
  return {
    id: application.id,
    status: application.status,
    legalEntityName: application.data.legalEntityName ?? "(unnamed applicant)",
    gstin: application.data.gstin,
    contactEmail: application.data.contactEmail,
    city: application.data.city,
    state: application.data.state,
    gstinVerified: application.gstinVerification?.outcome === "verified",
    documentCount: application.documents.length,
    sapCustomerCode: application.sapCustomerCode,
    submittedAt: application.submittedAt,
    createdAt: application.events[0]?.at ?? new Date(),
  };
}

export async function listApplications(
  _tenantId: string,
  filter: ListApplicationsFilter = {},
): Promise<OnboardingApplicationSummary[]> {
  let rows = applications().map(summarize);
  if (filter.status) rows = rows.filter((row) => row.status === filter.status);

  const search = filter.search?.trim().toLowerCase();
  if (search) {
    rows = rows.filter(
      (row) =>
        row.legalEntityName.toLowerCase().includes(search) ||
        row.gstin?.toLowerCase().includes(search) ||
        row.contactEmail?.toLowerCase().includes(search),
    );
  }

  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, filter.limit ?? 100);
}

export async function getApplicationForReview(
  _tenantId: string,
  id: string,
): Promise<OnboardingApplication> {
  return strip(find(id));
}

export interface ApprovalDecision {
  salesOrg: string;
  distributionChannel: string;
  creditApprovalStatus?: string;
  actorUserId: string;
}

export interface ApprovalResult {
  application: OnboardingApplication;
  kunnr: string;
  contactEmail: string;
  legalEntityName: string;
}

export async function approveApplication(
  adapter: SapAdapter,
  _tenantId: string,
  id: string,
  decision: ApprovalDecision,
): Promise<ApprovalResult> {
  const application = find(id);

  const created = await adapter
    .createCustomer(
      toCanonicalCustomer(application.data as never, {
        salesOrg: decision.salesOrg,
        distributionChannel: decision.distributionChannel,
      }),
    )
    .catch(() => {
      throw new OnboardingError(
        "SAP refused the customer creation.",
        "upstream_rejected",
        422,
      );
    });

  application.salesOrg = decision.salesOrg;
  application.distributionChannel = decision.distributionChannel;
  application.creditApprovalStatus = decision.creditApprovalStatus;
  application.sapCustomerCode = created.kunnr;
  application.decidedAt = new Date();
  transition(application, "Approved");

  return {
    application: strip(application),
    kunnr: created.kunnr,
    contactEmail: application.data.contactEmail ?? "",
    legalEntityName: application.data.legalEntityName ?? "",
  };
}

export async function rejectApplication(
  _tenantId: string,
  id: string,
  input: { reasons: string[]; note?: string; actorUserId: string },
): Promise<OnboardingApplication> {
  const application = find(id);
  application.rejectionReasons = input.reasons;
  application.reviewNote = input.note;
  application.decidedAt = new Date();
  transition(application, "Rejected", input.note);
  return strip(application);
}

export async function requestMoreInfo(
  _tenantId: string,
  id: string,
  input: { note: string; actorUserId: string },
): Promise<OnboardingApplication> {
  const application = find(id);
  application.reviewNote = input.note;
  // The "Request More Info" path sends the application back to the applicant
  // as the same record, rather than starting again.
  transition(application, "Draft", input.note);
  return strip(application);
}

// ---------------------------------------------------------------------------
// Back-office registration wizard (ADR-056)
// ---------------------------------------------------------------------------

export interface StartBackOfficeRegistrationResult {
  application: OnboardingApplication;
}

export interface RegisterCustomerDecision {
  salesOrg: string;
  distributionChannel: string;
  creditApprovalStatus?: string;
  actorUserId: string;
}

export async function startBackOfficeRegistration(
  tenantId: string,
): Promise<StartBackOfficeRegistrationResult> {
  const started = await startApplication(tenantId);
  return { application: started.application };
}

export async function listBackOfficeRegistrations(
  tenantId: string,
  filter: ListApplicationsFilter = {},
) {
  return listApplications(tenantId, filter);
}

export async function getBackOfficeRegistration(
  tenantId: string,
  id: string,
): Promise<OnboardingApplication> {
  return getApplicationForReview(tenantId, id);
}

export async function saveBackOfficeStep(
  _tenantId: string,
  id: string,
  step: number,
  data: Partial<OnboardingApplicationInput>,
): Promise<OnboardingApplication> {
  const application = find(id);
  if (step < 1 || step > ONBOARDING_STEP_COUNT) {
    throw new OnboardingError(`Step ${step} doesn't exist.`, "invalid_step", 422);
  }
  application.data = { ...application.data, ...data };
  return strip(application);
}

export async function uploadBackOfficeDocument(
  _tenantId: string,
  id: string,
  input: UploadDocumentInput,
): Promise<OnboardingApplication> {
  const application = find(id);
  return uploadDocument(_tenantId, { applicationId: id, draftToken: application.draftToken }, input);
}

export async function removeBackOfficeDocument(
  _tenantId: string,
  id: string,
  kind: OnboardingDocumentKind,
): Promise<OnboardingApplication> {
  const application = find(id);
  return removeDocument(
    _tenantId,
    { applicationId: id, draftToken: application.draftToken },
    kind,
  );
}

export async function verifyBackOfficeGstin(
  _tenantId: string,
  id: string,
  gstin: string,
): Promise<OnboardingApplication> {
  const application = find(id);
  application.gstinVerification = demoGstinVerification(gstin, application);
  return strip(application);
}

export async function registerCustomer(
  adapter: SapAdapter,
  tenantId: string,
  id: string,
  decision: RegisterCustomerDecision,
): Promise<ApprovalResult> {
  const application = find(id);
  // The back-office path skips the applicant's submit step; the desk *is*
  // the reviewer, so the record goes straight to Submitted then Approved.
  if (application.status === "Draft") transition(application, "Submitted");
  return approveApplication(adapter, tenantId, id, decision);
}

export { toCanonicalCustomer };
