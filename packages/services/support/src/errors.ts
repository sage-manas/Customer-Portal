/**
 * Domain errors for the support module. Route handlers map these to status
 * codes and render `message` as-is — docs/05 §11 (what happened + what it
 * means + what to do), so no handler invents customer-facing copy.
 */

export type SupportErrorCode =
  /** No such ticket *for this tenant and this sold-to account*. Always 404,
   *  never 403 — the portal must not confirm another customer's ticket
   *  exists (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The ticket is not in a state where this action is possible — resolving
   *  a closed ticket, reopening after the window, rating twice. */
  | "not_allowed"
  /** The session has no sold-to account, so there are no tickets to show. */
  | "no_account"
  /** An attachment couldn't be stored — retryable. */
  | "upstream_unavailable";

export interface SupportIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<SupportErrorCode, string> = {
  not_found: "We couldn't find that ticket.",
  invalid: "Some details need fixing before we can raise this.",
  not_allowed:
    "That can't be done to this ticket right now — it may already be closed, or past the point where it can be reopened.",
  no_account:
    "Your login isn't linked to a sold-to account yet, so we can't show tickets for you. Ask your administrator to link one.",
  upstream_unavailable:
    "We couldn't store that attachment. Nothing was submitted — try again in a moment.",
};

const STATUS: Record<SupportErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  not_allowed: 409,
  no_account: 409,
  upstream_unavailable: 503,
};

export class SupportError extends Error {
  readonly code: SupportErrorCode;
  readonly status: number;
  readonly issues: SupportIssue[];

  constructor(
    code: SupportErrorCode,
    options: { message?: string; issues?: SupportIssue[]; cause?: unknown } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "SupportError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
  }
}

export function isSupportError(error: unknown): error is SupportError {
  return error instanceof SupportError;
}

/** Turns a Zod failure into the issue list the screens render. */
export function invalidFrom(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): SupportError {
  return new SupportError("invalid", {
    issues: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
}
