/**
 * Typed SAP errors.
 *
 * Drivers throw these; services catch them and translate to domain errors
 * with user-facing copy (docs/06 engineering standards: "never leak SAP raw
 * errors to UI — map through an error translator per doc 05 §11"). The raw
 * SAP message is preserved in `sapMessage`/`sapMessageId` so it can be
 * logged and shown on admin screens, but it is never the string the
 * customer reads.
 */

export type SapErrorKind =
  /** SAP rejected the payload (field validation, missing customizing). */
  | "validation"
  /** Document/master record does not exist, or not for this customer. */
  | "not_found"
  /** SAP service user lacks the authorization object for this call. */
  | "authorization"
  /** Connection/timeout/circuit-open — retryable, degrade to cache (docs/05 P7). */
  | "unavailable"
  /** The call is not supported by this driver yet. */
  | "not_implemented"
  /** Anything the driver could not classify. */
  | "unknown";

export interface SapErrorOptions {
  kind: SapErrorKind;
  /** Raw SAP message text (BAPIRET2-MESSAGE / OData error message). */
  sapMessage?: string;
  /** BAPIRET2 ID + NUMBER, e.g. "V1/302". */
  sapMessageId?: string;
  /** Portal field the error maps to, when the driver can determine it. */
  field?: string;
  /** True when a retry might succeed (docs/02 §4.3 retry with backoff). */
  retryable?: boolean;
  cause?: unknown;
}

export class SapError extends Error {
  readonly kind: SapErrorKind;
  readonly sapMessage?: string;
  readonly sapMessageId?: string;
  readonly field?: string;
  readonly retryable: boolean;

  constructor(message: string, options: SapErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "SapError";
    this.kind = options.kind;
    this.sapMessage = options.sapMessage;
    this.sapMessageId = options.sapMessageId;
    this.field = options.field;
    this.retryable = options.retryable ?? options.kind === "unavailable";
  }
}

export function isSapError(error: unknown): error is SapError {
  return error instanceof SapError;
}

export const sapNotFound = (what: string, id: string): SapError =>
  new SapError(`${what} ${id} not found`, { kind: "not_found" });

export const sapValidation = (message: string, field?: string, sapMessageId?: string): SapError =>
  new SapError(message, { kind: "validation", field, sapMessage: message, sapMessageId });

export const sapUnavailable = (message: string, cause?: unknown): SapError =>
  new SapError(message, { kind: "unavailable", retryable: true, cause });

export const sapNotImplemented = (driver: string, operation: string): SapError =>
  new SapError(`The ${driver} SAP driver does not implement ${operation} yet`, {
    kind: "not_implemented",
  });
