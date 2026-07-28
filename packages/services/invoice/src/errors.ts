/**
 * Domain errors for the billing module. Route handlers map these to status
 * codes and render `message` as-is — written to the docs/05 §11 pattern
 * (what happened + what it means + what to do), so no handler has to invent
 * customer-facing copy.
 */

export type InvoiceErrorCode =
  /** No such billing document *for this customer*. Always 404, never 403
   *  (CLAUDE.md rule 5) — SAP reads a VBRK by VBELN alone, so a wrong
   *  answer here would confirm another customer's invoice exists. */
  | "not_found"
  /** The session has no sold-to account, so there is nothing to bill against. */
  | "no_account"
  /** SAP was unreachable — retryable. */
  | "upstream_unavailable";

const MESSAGES: Record<InvoiceErrorCode, string> = {
  not_found: "We couldn't find that invoice.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so there are no invoices to show. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach SAP to load your billing documents. Nothing is wrong with your account — try again in a moment.",
};

const STATUS: Record<InvoiceErrorCode, number> = {
  not_found: 404,
  no_account: 409,
  upstream_unavailable: 503,
};

export interface InvoiceIssue {
  field: string;
  message: string;
}

export class InvoiceError extends Error {
  readonly code: InvoiceErrorCode;
  readonly status: number;
  readonly issues: InvoiceIssue[];
  /** Raw SAP message. Logged and shown on admin screens only, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: InvoiceErrorCode,
    options: {
      message?: string;
      issues?: InvoiceIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "InvoiceError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isInvoiceError(error: unknown): error is InvoiceError {
  return error instanceof InvoiceError;
}
