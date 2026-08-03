export {
  completeMockCheckout,
  getPayment,
  handleGatewayWebhook,
  initiatePayment,
  listPayments,
  listPaymentExceptions,
  listPendingSync,
  postCapturedPayment,
  reconcilePayment,
  type InitiatedPayment,
  type PaymentException,
  type WebhookResult,
} from "./payment-service";

export {
  getStatement,
  listPayableItems,
  toPaymentReadError,
  type PayableItem,
  type PayableItemsResult,
  type StatementResult,
} from "./statement-service";

export { getPaymentGatewayForTenant } from "./adapters";

export { PaymentError, isPaymentError, type PaymentErrorCode, type PaymentIssue } from "./errors";

/**
 * Re-exported so app code can build the dev checkout flow without importing
 * `@cc/adapter-payment` directly — `apps -> adapters` is not an allowed edge
 * (CLAUDE.md rule 1).
 */
export {
  isPaymentGatewayError,
  type GatewayPaymentStatus,
  type PaymentGateway,
} from "@cc/adapter-payment";
