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
  | "operator_email_taken"
  | "invalid_sap_config"
  | "not_found";

const STATUS: Record<PlatformErrorCode, number> = {
  invalid_credentials: 401,
  account_inactive: 403,
  session_invalid: 401,
  session_expired: 401,
  forbidden: 403,
  tenant_slug_taken: 409,
  operator_email_taken: 409,
  invalid_sap_config: 400,
  not_found: 404,
};

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly status: number;

  /**
   * `detail` is the message a human reads; the code stays the thing code
   * branches on. Added for the SAP configuration form, where "invalid"
   * without naming the field is an error message that costs an operator a
   * support ticket. It is never populated from anything secret — the
   * validation messages come from the field registry's labels.
   */
  constructor(code: PlatformErrorCode, options?: { cause?: unknown; detail?: string }) {
    super(options?.detail ?? code, { cause: options?.cause });
    this.name = "PlatformError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isPlatformError(error: unknown): error is PlatformError {
  return error instanceof PlatformError;
}
