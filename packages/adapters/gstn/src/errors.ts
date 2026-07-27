/**
 * Typed GSTN errors. Drivers throw these; the onboarding service turns them
 * into user-facing copy (docs/05 §11) — the raw upstream message is kept
 * for logs and admin screens but is never what the applicant reads.
 */

export type GstnErrorKind =
  /** Not a well-formed GSTIN — rejected before any network call. */
  | "invalid_format"
  /** Well-formed, but GSTN has no such registration. */
  | "not_found"
  /** GSTN unreachable / rate-limited — retryable. */
  | "unavailable"
  /** The driver doesn't implement this call yet. */
  | "not_implemented";

export class GstnError extends Error {
  readonly kind: GstnErrorKind;
  readonly retryable: boolean;
  /** Raw upstream message, for logging only. */
  readonly upstreamMessage?: string;

  constructor(
    message: string,
    options: { kind: GstnErrorKind; upstreamMessage?: string; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "GstnError";
    this.kind = options.kind;
    this.upstreamMessage = options.upstreamMessage;
    this.retryable = options.kind === "unavailable";
  }
}

export function isGstnError(error: unknown): error is GstnError {
  return error instanceof GstnError;
}
