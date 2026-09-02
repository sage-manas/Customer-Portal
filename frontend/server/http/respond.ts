import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";

import { AuthError, isAuthError } from "../auth/errors";
import { serverEnv } from "../env";
import { ValidationError, isAppError, type FieldIssue } from "../errors";

/**
 * The wire format.
 *
 * Deliberately *not* the `{ success, data }` envelope a greenfield API would
 * use. This codebase already has a convention: the 76 route handlers this
 * backend restores returned the domain payload at the top level (`{ cart }`,
 * `{ order }`, `{ materials }`), and the 30 migrated client components read it
 * that way — `const { cart } = await response.json()`. They also branch on
 * `response.ok` and `response.status`, and render `body.error` as the message.
 *
 * Wrapping every payload now would mean editing all of them, which is exactly
 * the frontend rewrite this work is meant to avoid. So success keeps the
 * existing shape, and only the *error* shape is standardised — it already was,
 * informally: `{ error, code, issues }`.
 */

export function ok<T>(payload: T, status = 200): NextResponse {
  return NextResponse.json(payload ?? null, { status });
}

export function created<T>(payload: T): NextResponse {
  return ok(payload, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export interface ErrorBody {
  error: string;
  code: string;
  issues?: FieldIssue[];
}

export function failure(
  message: string,
  status: number,
  code: string,
  issues?: FieldIssue[],
): NextResponse<ErrorBody> {
  return NextResponse.json({ error: message, code, ...(issues ? { issues } : {}) }, { status });
}

function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Maps anything thrown beneath a handler onto a response.
 *
 * The rule about what reaches the client: a message we wrote is safe, and
 * anything else is not. `AppError`/`AuthError` messages are authored sentences
 * meant to be read, so they pass through. An unrecognised throw is a defect —
 * its message could name a table, a column, a connection string or a driver
 * stack, so it is logged in full and answered with one generic sentence.
 */
export function toErrorResponse(error: unknown, context: string): NextResponse<ErrorBody> {
  if (error instanceof ZodError) {
    const validation = new ValidationError(undefined, zodIssues(error));
    return failure(validation.message, validation.status, validation.code, validation.issues);
  }

  if (isAuthError(error)) {
    return failure(error.message, error.status, error.code);
  }

  if (isAppError(error)) {
    if (error.status >= 500) {
      console.error(`[api] ${context}`, {
        code: error.code,
        message: error.message,
        upstream: error.upstreamMessage,
        cause: error.cause,
      });
    }
    return failure(error.message, error.status, error.code, error.issues);
  }

  /**
   * Service errors matched structurally rather than by class.
   *
   * Every service in `packages/services/*` defines its own error type over a
   * shared base carrying `status`, `code` and optionally `issues` — and they
   * are being moved onto `AppError` one module at a time. Matching the shape
   * rather than the class is what lets a converted and an unconverted service
   * answer identically in the meantime, and it is the same structural check
   * `lib/safe-read.ts` already makes on the read path.
   *
   * The message is authored copy in both cases, so it is safe to return; the
   * status is trusted only when it is a real HTTP client/server code.
   */
  const shaped = error as { status?: unknown; code?: unknown; message?: unknown; issues?: unknown };
  if (
    typeof shaped.status === "number" &&
    shaped.status >= 400 &&
    shaped.status <= 599 &&
    typeof shaped.message === "string"
  ) {
    if (shaped.status >= 500) console.error(`[api] ${context}`, error);
    return failure(
      shaped.message,
      shaped.status,
      typeof shaped.code === "string" ? shaped.code : "internal_error",
      Array.isArray(shaped.issues) ? (shaped.issues as FieldIssue[]) : undefined,
    );
  }

  console.error(`[api] ${context} — unhandled`, error);

  return failure(
    // In development the real message is worth far more than the caution,
    // and there is no third party to leak it to.
    serverEnv.NODE_ENV === "development" && error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.",
    500,
    "internal_error",
  );
}

/** Parses a JSON body against a schema, raising the shared ValidationError. */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError("Expected a JSON body.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(undefined, zodIssues(result.error));
  return result.data;
}

/** Parses `searchParams` against a schema. */
export function parseQuery<T>(url: URL, schema: ZodSchema<T>): T {
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(undefined, zodIssues(result.error));
  return result.data;
}

export { AuthError };
