/**
 * Authentication failures, as a closed set.
 *
 * Kept separate from the service errors in server/errors.ts because these are
 * the only ones the session layer raises, and because the *message* a caller
 * sees must not vary with the reason: "no such email" and "wrong password"
 * both surface as `bad_credentials` with one sentence, or the login form
 * becomes an account-enumeration oracle.
 */

export const AUTH_ERROR_CODES = [
  "unauthenticated",
  "bad_credentials",
  "session_expired",
  "session_invalid",
  "forbidden",
  "no_account",
  "account_inactive",
  "tenant_inactive",
  "tenant_unresolved",
  "password_change_required",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const MESSAGES: Record<AuthErrorCode, string> = {
  unauthenticated: "You need to sign in to do that.",
  bad_credentials: "That email and password don't match an account.",
  session_expired: "Your session has expired — please sign in again.",
  session_invalid: "Your session is no longer valid — please sign in again.",
  forbidden: "You don't have permission to do that.",
  no_account: "No customer account is linked to this login.",
  account_inactive: "This account has been deactivated.",
  tenant_inactive: "This portal is not currently available.",
  // Not a credentials problem, and saying so saves an hour of trying
  // passwords that were always going to be refused. It reveals nothing about
  // any account: the fact it describes is the address, not the user.
  tenant_unresolved:
    "This address isn't linked to a portal. Sign in at your company's address, e.g. http://acme.localhost:3000.",
  password_change_required: "You need to set a new password before continuing.",
};

const STATUSES: Record<AuthErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  session_expired: 401,
  session_invalid: 401,
  forbidden: 403,
  no_account: 403,
  account_inactive: 403,
  tenant_inactive: 403,
  tenant_unresolved: 400,
  password_change_required: 403,
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, options: { cause?: unknown } = {}) {
    super(MESSAGES[code], options);
    this.name = "AuthError";
    this.code = code;
    this.status = STATUSES[code];
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
