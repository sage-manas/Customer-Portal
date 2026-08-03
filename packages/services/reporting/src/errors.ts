/**
 * Domain errors for reporting. Route handlers map these to status codes and
 * render `message` as-is — docs/05 §11's pattern (what happened + what it
 * means + what to do), so no handler invents customer-facing copy.
 */

export type ReportingErrorCode =
  /** The session has no sold-to account, so there is nothing to report on. */
  | "no_account"
  /** An unknown reporting period arrived on the query string. */
  | "invalid_period"
  /** SAP was unreachable and no cached answer was available — retryable. */
  | "upstream_unavailable";

const MESSAGES: Record<ReportingErrorCode, string> = {
  no_account:
    "Your login isn't linked to a sold-to account yet, so there's nothing to report on. Ask your administrator to link one.",
  invalid_period: "That reporting period isn't one we offer. Pick one from the list and try again.",
  upstream_unavailable:
    "We couldn't reach SAP to build your reports, and we have nothing recent enough to show instead. Try again in a moment.",
};

const STATUS: Record<ReportingErrorCode, number> = {
  no_account: 409,
  invalid_period: 400,
  upstream_unavailable: 503,
};

export class ReportingError extends Error {
  readonly code: ReportingErrorCode;
  readonly status: number;

  constructor(code: ReportingErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? MESSAGES[code], { cause: options?.cause });
    this.name = "ReportingError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isReportingError(error: unknown): error is ReportingError {
  return error instanceof ReportingError;
}
