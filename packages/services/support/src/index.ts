export { SupportError, isSupportError, type SupportErrorCode, type SupportIssue } from "./errors";

export {
  addCustomerComment,
  createTicket,
  getTicket,
  insertTicket,
  listTickets,
  rateTicket,
  routedRoleFor,
  transitionTicketAsCustomer,
  type InsertTicketInput,
  type RelatedDocValidator,
  type SupportContext,
  type TicketListFilter,
  type TicketListResult,
} from "./ticket-service";

export {
  addAgentComment,
  assignTicket,
  getTicketForAgent,
  listWorkbench,
  resolveTicket,
  transitionTicketAsAgent,
  WORKBENCH_PRIORITIES,
  type AgentContext,
  type WorkbenchFilter,
  type WorkbenchQuery,
  type WorkbenchResult,
} from "./workbench-service";

export { sweepSlaBreaches, type SlaBreach } from "./sla-service";

export { raiseDiscrepancyTicket, type AutoTicketResult } from "./auto-ticket";

export {
  describeAttachments,
  uploadTicketAttachment,
  type UploadAttachmentInput,
  type UploadedAttachment,
} from "./attachment-service";

export { attachmentStorageKey, getSupportStorage } from "./adapters";

export {
  readOwnedTicket,
  type AttachmentRecord,
  type CommentVisibility,
  type TicketCommentRecord,
  type TicketRecord,
  type TicketSummary,
} from "./ticket-store";
