/**
 * Typed gateway errors. Drivers throw these; the payment service turns them
 * into user-facing copy (docs/05 §11). The raw upstream message is kept for
 * logs and reconciliation, never shown to a customer — a gateway's own
 * failure strings are written for merchants, not buyers.
 */

export type PaymentGatewayErrorKind =
  /** The request itself was malformed (bad amount, unsupported method). */
  | "invalid_request"
  /** No such payment/order at the gateway. */
  | "not_found"
  /** Webhook signature didn't verify — treat as hostile, not as a retry. */
  | "invalid_signature"
  /** Gateway unreachable or rate-limited — retryable. */
  | "unavailable"
  /** The driver doesn't implement this call yet (ADR-006). */
  | "not_implemented";

export class PaymentGatewayError extends Error {
  readonly kind: PaymentGatewayErrorKind;
  readonly retryable: boolean;
  readonly upstreamMessage?: string;

  constructor(
    message: string,
    options: { kind: PaymentGatewayErrorKind; upstreamMessage?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "PaymentGatewayError";
    this.kind = options.kind;
    this.upstreamMessage = options.upstreamMessage;
    this.retryable = options.kind === "unavailable";
  }
}

export function isPaymentGatewayError(error: unknown): error is PaymentGatewayError {
  return error instanceof PaymentGatewayError;
}
