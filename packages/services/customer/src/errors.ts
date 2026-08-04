/**
 * Domain errors for the customer directory.
 *
 * Same shape as every other service's (`code`, `status`, user-safe
 * `message`, optional field `issues`), so `toAdminErrorResponse` maps it the
 * way it maps the rest.
 */

export type CustomerErrorCode =
  "not_found" | "invalid" | "conflict" | "upstream_unavailable" | "sap_rejected";

export interface CustomerIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<CustomerErrorCode, string> = {
  not_found: "We couldn't find that customer.",
  invalid: "Some details need fixing.",
  conflict: "That change conflicts with the customer's current state.",
  upstream_unavailable:
    "SAP isn't reachable right now, so the customer master couldn't be updated. Nothing was changed — try again shortly.",
  sap_rejected: "SAP refused the change. The message below is SAP's own.",
};

const STATUS: Record<CustomerErrorCode, number> = {
  // A customer of another tenant is indistinguishable from one that does not
  // exist — CLAUDE.md rule 5, and the reason there is no 403 in this table.
  not_found: 404,
  invalid: 422,
  conflict: 409,
  upstream_unavailable: 503,
  sap_rejected: 422,
};

export class CustomerError extends Error {
  readonly code: CustomerErrorCode;
  readonly status: number;
  readonly issues: CustomerIssue[];
  /** SAP's own words, for the back-office screen only. */
  readonly upstreamMessage?: string;

  constructor(
    code: CustomerErrorCode,
    options: { issues?: CustomerIssue[]; upstreamMessage?: string; cause?: unknown } = {},
  ) {
    super(MESSAGES[code], { cause: options.cause });
    this.name = "CustomerError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isCustomerError(error: unknown): error is CustomerError {
  return error instanceof CustomerError;
}
