/**
 * Operator-plane error, distinct from `@cc/service-identity`'s `AuthError`:
 * the two realms deliberately share no code (docs/DECISIONS.md ADR-045), so
 * `apps/ops`'s route handlers need their own thing to catch.
 */

export type PlatformErrorCode =
  | "invalid_credentials"
  | "account_inactive"
  | "session_invalid"
  | "session_expired"
  | "forbidden"
  | "tenant_slug_taken"
  | "not_found";

const STATUS: Record<PlatformErrorCode, number> = {
  invalid_credentials: 401,
  account_inactive: 403,
  session_invalid: 401,
  session_expired: 401,
  forbidden: 403,
  tenant_slug_taken: 409,
  not_found: 404,
};

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly status: number;

  constructor(code: PlatformErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "PlatformError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError;
}
