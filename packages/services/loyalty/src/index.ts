export { LoyaltyError, isLoyaltyError, type LoyaltyErrorCode, type LoyaltyIssue } from "./errors";

export {
  getCreditPosition,
  getCreditPositionForDesk,
  requireAccount,
  toLoyaltyError,
  type CreditContext,
  type CreditPositionResult,
} from "./credit-service";

export { getLoyaltyPosition, type LoyaltyPosition } from "./loyalty-service";

export { getTierThresholds, saveTierThresholds } from "./tier-settings";

export {
  getCreditRequest,
  listCreditRequests,
  requestCreditIncrease,
  withdrawCreditRequest,
  type CreditRequestListResult,
} from "./credit-request-service";

export {
  decideCreditRequest,
  getCreditRequestForDesk,
  listCreditRequestQueue,
  type CreditQueueFilter,
  type CreditQueueResult,
  type DeskContext,
} from "./credit-desk-service";

export type { CreditRequestRecord } from "./credit-request-store";

export {
  listRebateSettlements,
  rebateSettlementReference,
  settleRebate,
  type RebateQueueFilter,
  type RebateQueueResult,
} from "./rebate-desk-service";
