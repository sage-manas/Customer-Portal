/**
 * Domain errors for the inquiry & quotation module. Route handlers map these
 * to status codes and render `message` as-is — docs/05 §11 (what happened +
 * what it means + what to do), so no handler invents customer-facing copy.
 */

export type InquiryErrorCode =
  /** No such document *for this tenant and this sold-to account*. Always 404,
   *  never 403 — the portal must not confirm another customer's quotation
   *  exists (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** SAP refused the document itself — an inquiry it won't price, a quotation
   *  it won't copy. A business answer, not an outage. */
  | "rejected"
  /** The document is not in a state where this action is possible: an expired
   *  quotation, one already converted, one already answered. */
  | "not_allowed"
  /** The session has no sold-to account, so there is nothing to quote for. */
  | "no_account"
  /** SAP was unreachable — retryable, and nothing was created. */
  | "upstream_unavailable";

export interface InquiryIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<InquiryErrorCode, string> = {
  not_found: "We couldn't find that document.",
  invalid: "Some details need fixing before we can send this.",
  rejected: "Our system couldn't accept this request.",
  not_allowed:
    "That can't be done to this quotation — it may have expired, or already been turned into an order.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so we can't raise an inquiry for you. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach the system that handles quotations. Nothing was sent — try again in a moment.",
};

const STATUS: Record<InquiryErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  rejected: 422,
  not_allowed: 409,
  no_account: 409,
  upstream_unavailable: 503,
};

export class InquiryError extends Error {
  readonly code: InquiryErrorCode;
  readonly status: number;
  readonly issues: InquiryIssue[];
  /** Raw SAP text. Passed to the back office, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: InquiryErrorCode,
    options: {
      message?: string;
      issues?: InquiryIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "InquiryError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isInquiryError(error: unknown): error is InquiryError {
  return error instanceof InquiryError;
}

/** Turns a Zod failure into the issue list the screens render. */
export function invalidFrom(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): InquiryError {
  return new InquiryError("invalid", {
    issues: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
}
