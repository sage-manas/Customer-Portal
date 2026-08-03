/**
 * Domain errors for the notification module. Route handlers map these to
 * status codes and render `message` as-is — docs/05 §11, so no handler
 * invents customer-facing copy.
 */

export type NotificationServiceErrorCode =
  /** No such notification *for this tenant and this user*. Always 404, never
   *  403 — a bell row names a document, and confirming one exists for
   *  somebody else is the leak CLAUDE.md rule 5 forbids. */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid";

export interface NotificationIssue {
  field: string;
  message: string;
}

const MESSAGES: Record<NotificationServiceErrorCode, string> = {
  not_found: "We couldn't find that notification.",
  invalid: "That request didn't look right.",
};

const STATUS: Record<NotificationServiceErrorCode, number> = {
  not_found: 404,
  invalid: 422,
};

export class NotificationServiceError extends Error {
  readonly code: NotificationServiceErrorCode;
  readonly status: number;
  readonly issues: NotificationIssue[];

  constructor(
    code: NotificationServiceErrorCode,
    options: { message?: string; issues?: NotificationIssue[]; cause?: unknown } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "NotificationServiceError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
  }
}

export function isNotificationServiceError(error: unknown): error is NotificationServiceError {
  return error instanceof NotificationServiceError;
}

export function invalidFrom(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): NotificationServiceError {
  return new NotificationServiceError("invalid", {
    issues: error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    })),
  });
}
