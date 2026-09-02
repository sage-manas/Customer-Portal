/**
 * The error taxonomy every service raises and every route handler maps.
 *
 * One base class with a `code` and a `status`, because the frontend already
 * reads exactly that: `lib/safe-read.ts` degrades a screen on
 * `code === "upstream_unavailable"` or a 502/503, and the migrated components
 * read `response.status` and `body.error`. Matching the existing contract is
 * what lets the backend land without touching those files.
 */

export type ErrorCode =
  | "validation_error"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_error"
  | "internal_error";

export interface FieldIssue {
  path: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues?: FieldIssue[];
  /**
   * The upstream's own words. Logged, and shown only where a screen already
   * shows one (the SAP config test button); never merged into `message`,
   * which is the sentence a user reads.
   */
  readonly upstreamMessage?: string;

  constructor(
    message: string,
    options: {
      code?: ErrorCode;
      status?: number;
      issues?: FieldIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code ?? "internal_error";
    this.status = options.status ?? 500;
    this.issues = options.issues;
    this.upstreamMessage = options.upstreamMessage;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Please check the highlighted fields.", issues: FieldIssue[] = []) {
    super(message, { code: "validation_error", status: 400, issues });
    this.name = "ValidationError";
  }
}

/**
 * Used for a document that exists but belongs to another tenant or another
 * sold-to account, as well as for one that does not exist.
 *
 * That collapse is deliberate and load-bearing: a 403 would confirm the
 * document is real, which tells one customer that another customer's order
 * number is valid. Cross-tenant and cross-customer reads are always 404.
 */
export class NotFoundError extends AppError {
  constructor(what = "That record") {
    super(`${what} could not be found.`, { code: "not_found", status: 404 });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, { code: "conflict", status: 409 });
    this.name = "ConflictError";
  }
}

/**
 * An upstream we could not reach. Distinct from `UpstreamError` because only
 * this class means "try again shortly, nothing is wrong with the request" —
 * and it is the one the screens degrade on instead of failing.
 */
export class UpstreamUnavailableError extends AppError {
  constructor(message = "We couldn't reach SAP just now.", upstreamMessage?: string) {
    super(message, { code: "upstream_unavailable", status: 502, upstreamMessage });
    this.name = "UpstreamUnavailableError";
  }
}

/** An upstream that answered, and refused. */
export class UpstreamError extends AppError {
  constructor(message: string, upstreamMessage?: string) {
    super(message, { code: "upstream_error", status: 502, upstreamMessage });
    this.name = "UpstreamError";
  }
}

/** Something the portal has not built yet — never a silent 500. */
export class NotImplementedError extends AppError {
  constructor(what: string) {
    super(`${what} isn't available yet.`, { code: "upstream_error", status: 501 });
    this.name = "NotImplementedError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
