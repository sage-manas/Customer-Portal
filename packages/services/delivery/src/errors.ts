/**
 * Domain errors for the delivery module. Route handlers map these to status
 * codes and render `message` as-is — written to the docs/05 §11 pattern
 * (what happened + what it means + what to do), so no handler invents
 * customer-facing copy.
 */

export type DeliveryErrorCode =
  /** No such delivery *for this tenant and this sold-to account*. Always 404,
   *  never 403 — the portal must not confirm another customer's shipment
   *  exists (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The shipment is not at a point where this action is possible — not yet
   *  despatched, or already signed for. */
  | "not_allowed"
  /** The session has no sold-to account, so there are no shipments to show. */
  | "no_account"
  /** SAP was unreachable — retryable. */
  | "upstream_unavailable";

export interface DeliveryIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<DeliveryErrorCode, string> = {
  not_found: "We couldn't find that delivery.",
  invalid: "Some details need fixing before we can record this receipt.",
  not_allowed:
    "This delivery can't be signed for right now — it either hasn't been despatched yet, or receipt has already been confirmed.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so we can't show deliveries for you. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach SAP to record this receipt. Nothing was submitted — try again in a moment.",
};

const STATUS: Record<DeliveryErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  not_allowed: 409,
  no_account: 409,
  upstream_unavailable: 503,
};

export class DeliveryError extends Error {
  readonly code: DeliveryErrorCode;
  readonly status: number;
  readonly issues: DeliveryIssue[];
  /** Raw SAP message. Logged and shown on admin screens only, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: DeliveryErrorCode,
    options: {
      message?: string;
      issues?: DeliveryIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "DeliveryError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isDeliveryError(error: unknown): error is DeliveryError {
  return error instanceof DeliveryError;
}
