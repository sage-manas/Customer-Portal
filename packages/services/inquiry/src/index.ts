export { InquiryError, isInquiryError, type InquiryErrorCode, type InquiryIssue } from "./errors";

export {
  createInquiry,
  getInquiry,
  listInquiries,
  toInquiryError,
  type InquiryContext,
  type InquiryDetail,
  type InquiryFilter,
  type InquiryListItem,
  type InquiryListResult,
} from "./inquiry-service";

export {
  acceptQuotation,
  acceptQuotationSchema,
  getQuotation,
  listQuotations,
  requestRevision,
  revisionRequestSchema,
  toQuotationView,
  type AcceptQuotationInput,
  type AcceptQuotationResult,
  type QuotationDetail,
  type QuotationFilter,
  type QuotationListResult,
  type QuotationView,
  type RevisionRequestInput,
} from "./quotation-service";

export {
  countDrafts,
  deleteDraft,
  getDraft,
  listDrafts,
  markDraftSubmitted,
  saveDraft,
  type InquiryDraft,
} from "./draft-service";

export {
  getInquiryForAgent,
  issueQuotation,
  issueQuotationSchema,
  listInquiryQueue,
  type AgentContext,
  type InquiryQueueResult,
  type IssueQuotationInput,
  type QueuedInquiry,
} from "./workbench-service";
