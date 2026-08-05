/**
 * Domain errors for the identity module.
 *
 * Services return/throw these; route handlers map them to status codes and
 * user-facing copy (docs/05 §11 error pattern). The message here is safe to
 * show — nothing in it distinguishes "no such user" from "wrong password",
 * because that distinction is exactly what credential-stuffing wants.
 */

export type AuthErrorCode =
  | "invalid_credentials"
  | "account_inactive"
  | "tenant_not_found"
  | "tenant_inactive"
  | "session_invalid"
  | "session_expired"
  | "forbidden"
  | "password_change_required";

const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "That email and password combination didn't work. Check both and try again.",
  account_inactive: "This account is inactive. Contact your administrator to have it re-enabled.",
  tenant_not_found: "We couldn't find a portal at this address.",
  tenant_inactive:
    "This portal has been deactivated. Contact your account manager to have it re-enabled.",
  session_invalid: "Your session isn't valid. Sign in again to continue.",
  session_expired: "Your session has expired. Sign in again to continue.",
  forbidden: "You don't have permission to do that. Contact your administrator if you need access.",
  password_change_required: "You need to set a new password before continuing.",
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  /** HTTP status a route handler should return. */
  readonly status: number;

  constructor(code: AuthErrorCode, options?: { cause?: unknown }) {
    super(MESSAGES[code], options);
    this.name = "AuthError";
    this.code = code;
    this.status = STATUS[code];
  }
}

const STATUS: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  account_inactive: 403,
  // Never 404-with-detail on a tenant probe; the copy above stays vague.
  tenant_not_found: 404,
  // 403, not 404: the portal exists and the person signing in is a customer
  // of it. Hiding that would send them to their IT department to debug DNS
  // for a decision an operator made deliberately (ADR-054).
  tenant_inactive: 403,
  session_invalid: 401,
  session_expired: 401,
  forbidden: 403,
  password_change_required: 403,
};

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
