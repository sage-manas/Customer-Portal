import type { OnboardingIssue } from "@cc/domain";

/**
 * Domain errors for the onboarding module. Route handlers map these to
 * status codes and show `message` as-is — it is written to the docs/05 §11
 * pattern (what happened + what it means + what to do), so a handler never
 * invents copy of its own.
 */

export type OnboardingErrorCode =
  /** No such application *for this tenant* — always 404, never 403 (CLAUDE.md rule 5). */
  | "not_found"
  /** Field-level validation failed; see `issues`. */
  | "invalid"
  /** The action isn't legal from the application's current status. */
  | "invalid_transition"
  /** Someone already registered this GSTIN with this tenant. */
  | "duplicate"
  /** The application can't be submitted yet (unverified GSTIN, missing docs). */
  | "incomplete"
  /** SAP rejected the customer creation. */
  | "sap_rejected"
  /** SAP or GSTN was unreachable — retryable. */
  | "upstream_unavailable";

const MESSAGES: Record<OnboardingErrorCode, string> = {
  not_found: "We couldn't find that application.",
  invalid: "Some details need fixing before you can continue.",
  invalid_transition: "This application has already moved on — reload the page to see where it is.",
  duplicate:
    "An application with this GSTIN already exists. If it's yours, continue from the link in your confirmation email instead of starting again.",
  incomplete: "A few things are still missing before this can be submitted.",
  sap_rejected: "SAP rejected the customer record. The details below need correcting first.",
  upstream_unavailable:
    "We couldn't reach the system that handles this. Nothing was lost — try again in a moment.",
};

const STATUS: Record<OnboardingErrorCode, number> = {
  not_found: 404,
  invalid: 422,
  invalid_transition: 409,
  duplicate: 409,
  incomplete: 422,
  sap_rejected: 422,
  upstream_unavailable: 503,
};

export class OnboardingError extends Error {
  readonly code: OnboardingErrorCode;
  readonly status: number;
  /** Field-level issues, for inline display next to the offending input. */
  readonly issues: OnboardingIssue[];
  /**
   * Raw upstream (SAP/GSTN) message. Logged and shown on admin screens
   * only — never rendered to a customer (docs/06 engineering standards).
   */
  readonly upstreamMessage?: string;

  constructor(
    code: OnboardingErrorCode,
    options: {
      message?: string;
      issues?: OnboardingIssue[];
      upstreamMessage?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? MESSAGES[code], { cause: options.cause });
    this.name = "OnboardingError";
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues ?? [];
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function isOnboardingError(error: unknown): error is OnboardingError {
  return error instanceof OnboardingError;
}
