import type { Permission, SessionClaims } from "@cc/domain";
import { AuthError, requirePermission } from "@cc/service-identity";
import { isInquiryError } from "@cc/service-inquiry";
import { isOnboardingError } from "@cc/service-onboarding";
import { isSupportError } from "@cc/service-support";
import { NextResponse } from "next/server";

import { getSession } from "./session";

/**
 * Guard + error mapping for back-office route handlers.
 *
 * Hiding a nav item is presentation; this is the control (docs/05 §4.3).
 * Every `/api/admin/*` handler starts with `requireBackOffice(permission)`
 * even though middleware already gated `/admin` on `admin:view` — that
 * check is coarse, and a `tenant_support` session must not be able to
 * approve a customer just because it can see the shell.
 */
export async function requireBackOffice(permission: Permission): Promise<SessionClaims> {
  return requirePermission(await getSession(), permission);
}

export function toAdminErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (isInquiryError(error)) {
    // `upstreamMessage` is included for the same reason onboarding's is: the
    // audience here is a sales user, who needs SAP's own words to act on a
    // rejected quotation. Customer-plane responses never carry it.
    return NextResponse.json(
      {
        error: error.message,
        issues: error.issues,
        code: error.code,
        upstreamMessage: error.upstreamMessage,
      },
      { status: error.status },
    );
  }
  if (isSupportError(error)) {
    // No `upstreamMessage`: a ticket is portal-owned, so there is no SAP text
    // behind its errors to pass on.
    return NextResponse.json(
      { error: error.message, issues: error.issues, code: error.code },
      { status: error.status },
    );
  }
  if (isOnboardingError(error)) {
    // `upstreamMessage` (raw SAP/GSTN text) is included here and only here:
    // the audience is the reviewer, who needs it to act (docs/06 error
    // handling). It is never in a customer-facing response.
    return NextResponse.json(
      {
        error: error.message,
        issues: error.issues,
        code: error.code,
        upstreamMessage: error.upstreamMessage,
      },
      { status: error.status },
    );
  }
  throw error;
}

export async function handleAdmin(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return toAdminErrorResponse(error);
  }
}
