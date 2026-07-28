/**
 * Domain errors for the sales-order module. Route handlers map these to
 * status codes and render `message` as-is — written to the docs/05 §11
 * pattern (what happened + what it means + what to do), so no handler has
 * to invent customer-facing copy.
 */

export type OrderErrorCode =
  /** No such order/draft *for this tenant and this sold-to account*. Always
   *  404, never 403 — the portal must not confirm another customer's order
   *  exists (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** SAP refused the order itself (MOQ, no condition record, ship-to). */
  | "rejected"
  /** The order is past the point where this action is possible. */
  | "not_allowed"
  /** The session has no sold-to account, so there is nothing to order for. */
  | "no_account"
  /** SAP was unreachable — retryable. */
  | "upstream_unavailable";

export interface OrderIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<OrderErrorCode, string> = {
  not_found: "We couldn't find that order.",
  invalid: "Some details need fixing before this order can go through.",
  rejected: "This order can't be placed as it stands.",
  not_allowed:
    "This order has moved too far along for that. Raise a change request and our team will pick it up.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so we can't place orders for you. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach SAP to place this order. Nothing was submitted — your details are saved; try again in a moment.",
};

const STATUS: Record<OrderErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  rejected: 422,
  not_allowed: 409,
  no_account: 409,
  upstream_unavailable: 503,
};

export class OrderError extends Error {
  readonly code: OrderErrorCode;
  readonly status: number;
  readonly issues: OrderIssue[];
  /** Raw SAP message. Logged and shown on admin screens only, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: OrderErrorCode,
    options: {
      message?: string;
      issues?: OrderIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "OrderError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isOrderError(error: unknown): error is OrderError {
  return error instanceof OrderError;
}
