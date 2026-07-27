export { OnboardingError, isOnboardingError, type OnboardingErrorCode } from "./errors";

export { documentStorageKey, getGstnAdapterForTenant, getOnboardingStorage } from "./adapters";

export {
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
  type ApprovalDecision,
  type ApprovalResult,
  type DraftHandle,
  type ListApplicationsFilter,
  type OnboardingApplicationSummary,
  type StartApplicationResult,
  type UploadDocumentInput,
} from "./onboarding-service";

export { toCanonicalCustomer } from "./to-canonical-customer";

/**
 * Re-exported so route handlers can render GSTN outcomes and errors without
 * importing the adapters layer, which `apps` may not do (CLAUDE.md rule 1).
 */
export { isGstnError, type GstnAdapter, type GstnTaxpayer } from "@cc/adapter-gstn";
