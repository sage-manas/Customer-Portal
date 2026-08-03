/**
 * Domain errors for Loyalty & Credit. Route handlers map these to status
 * codes and render `message` as-is — docs/05 §11 (what happened + what it
 * means + what to do), so no handler invents customer-facing copy.
 */

export type LoyaltyErrorCode =
  /** No such request *for this tenant and this sold-to account*. Always 404,
   *  never 403 — the portal must not confirm another customer's credit
   *  request exists (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The request is not in a state where this move is possible: already
   *  decided, already withdrawn, or the actor may not make it. */
  | "not_allowed"
  /** The account already has a request waiting on the credit desk. */
  | "already_pending"
  /** The session has no sold-to account, so there is no credit position. */
  | "no_account"
  /** SAP was unreachable — retryable, and nothing was changed. */
  | "upstream_unavailable";

export interface LoyaltyIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<LoyaltyErrorCode, string> = {
  not_found: "We couldn't find that request.",
  invalid: "Some details need fixing before we can send this.",
  not_allowed: "That can't be done to this request — it may already have been decided.",
  already_pending:
    "You already have a credit-limit request waiting with our credit team. We'll come back to you on that one.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so there's no credit position to show. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach the system that holds your credit position. Nothing was changed — try again in a moment.",
};

const STATUS: Record<LoyaltyErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  not_allowed: 409,
  already_pending: 409,
  no_account: 409,
  upstream_unavailable: 503,
};

export class LoyaltyError extends Error {
  readonly code: LoyaltyErrorCode;
  readonly status: number;
  readonly issues: LoyaltyIssue[];
  /** Raw SAP text. Passed to the back office, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: LoyaltyErrorCode,
    options: {
      message?: string;
      issues?: LoyaltyIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "LoyaltyError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isLoyaltyError(error: unknown): error is LoyaltyError {
  return error instanceof LoyaltyError;
}

/** Turns a Zod failure into the issue list the screens render. */
export function invalidFrom(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): LoyaltyError {
  return new LoyaltyError("invalid", {
    issues: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
}
