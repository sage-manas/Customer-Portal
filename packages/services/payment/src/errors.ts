/**
 * Domain errors for the payments module. Route handlers map these to status
 * codes and render `message` as-is — written to the docs/05 §11 pattern
 * (what happened + what it means + what to do).
 *
 * Copy here carries an extra obligation the rest of the portal doesn't: when
 * something goes wrong around money, the message must say what happened to
 * the money. "Try again" is not enough if the customer can't tell whether
 * they have been charged (docs/05 §7.7 return states).
 */

export type PaymentErrorCode =
  /** No such payment, or no such open item, *for this customer*. Always 404. */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The selection can't be paid as it stands (item cleared, overpayment). */
  | "not_payable"
  /** The session has no sold-to account. */
  | "no_account"
  /** Webhook signature didn't verify — hostile until proven otherwise. */
  | "invalid_signature"
  /** The gateway was unreachable. Nothing was charged. */
  | "gateway_unavailable"
  /** Money was taken but SAP wouldn't post it — needs reconciliation, not a retry. */
  | "posting_failed"
  /** SAP was unreachable for a read — retryable. */
  | "upstream_unavailable";

export interface PaymentIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<PaymentErrorCode, string> = {
  not_found: "We couldn't find that payment.",
  invalid: "Some details need fixing before this payment can go through.",
  not_payable:
    "One or more of the invoices you selected can no longer be paid — they may have been settled already. Refresh and try again.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so there's nothing to pay. Ask your administrator to link one.",
  invalid_signature: "This payment notification couldn't be verified.",
  gateway_unavailable:
    "We couldn't reach the payment gateway. You have not been charged — please try again in a moment.",
  // Deliberately not a "try again": a retry here would take the money twice.
  posting_failed:
    "Your payment went through, but we couldn't record it against your invoices yet. Nothing has been charged twice — our team has been notified and your statement will update shortly.",
  upstream_unavailable:
    "We couldn't reach SAP to load your account position. Try again in a moment.",
};

const STATUS: Record<PaymentErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  not_payable: 422,
  no_account: 409,
  invalid_signature: 400,
  gateway_unavailable: 503,
  // 202: the payment itself succeeded — the *posting* is outstanding. A 5xx
  // would invite the client to retry a charge that already happened.
  posting_failed: 202,
  upstream_unavailable: 503,
};

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly status: number;
  readonly issues: PaymentIssue[];
  /** Raw upstream message (SAP/gateway). Logged; never shown to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: PaymentErrorCode,
    options: {
      message?: string;
      issues?: PaymentIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "PaymentError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isPaymentError(error: unknown): error is PaymentError {
  return error instanceof PaymentError;
}
