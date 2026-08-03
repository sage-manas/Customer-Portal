export type NotificationErrorKind = "misconfigured" | "unsupported_channel";

/**
 * The two things this adapter throws for, and neither is a provider fault —
 * those come back as `{ delivered: false }` (see contract.ts). Both are
 * programming or deployment errors: a driver asked for a channel it cannot
 * serve, or one configured without the settings it needs. Failing loudly
 * beats a mail nobody notices was never sent.
 */
export class NotificationError extends Error {
  readonly kind: NotificationErrorKind;

  constructor(message: string, options: { kind: NotificationErrorKind; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "NotificationError";
    this.kind = options.kind;
  }
}

export function isNotificationError(error: unknown): error is NotificationError {
  return error instanceof NotificationError;
}
