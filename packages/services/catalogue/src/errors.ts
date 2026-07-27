/**
 * Domain errors for the catalogue module. Route handlers map these to
 * status codes and render `message` as-is — written to the docs/05 §11
 * pattern (what happened + what it means + what to do), so no handler has
 * to invent customer-facing copy.
 */

export type CatalogueErrorCode =
  /** No such material, or no cart line with that id, *for this tenant/customer*.
   *  Always 404, never 403 (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The line breaks a rule SAP would also enforce (MOQ, unpriced material). */
  | "not_orderable"
  /** The session has no sold-to account, so there is nothing to price against. */
  | "no_account"
  /** SAP was unreachable — retryable. */
  | "upstream_unavailable";

export interface CatalogueIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<CatalogueErrorCode, string> = {
  not_found: "We couldn't find that item.",
  invalid: "Some details need fixing before you can continue.",
  not_orderable: "That quantity can't be ordered as it stands.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so we can't show your prices. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't reach SAP to price this. Nothing was lost — your cart is saved; try again in a moment.",
};

const STATUS: Record<CatalogueErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  not_orderable: 422,
  no_account: 409,
  upstream_unavailable: 503,
};

export class CatalogueError extends Error {
  readonly code: CatalogueErrorCode;
  readonly status: number;
  readonly issues: CatalogueIssue[];
  /** Raw SAP message. Logged and shown on admin screens only, never to a customer. */
  readonly upstreamMessage?: string;

  constructor(
    code: CatalogueErrorCode,
    options: {
      message?: string;
      issues?: CatalogueIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "CatalogueError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isCatalogueError(error: unknown): error is CatalogueError {
  return error instanceof CatalogueError;
}
