import type { Permission, SessionClaims } from "@cc/domain";
import { captureException, getLogger, runWithContext, setContextTenant } from "@cc/observability";
import { AuthError, requirePermission } from "@cc/service-identity";
import { isInquiryError } from "@cc/service-inquiry";
import { isLoyaltyError } from "@cc/service-loyalty";
import { isOnboardingError } from "@cc/service-onboarding";
import { isPaymentError } from "@cc/service-payment";
import { isSupportError } from "@cc/service-support";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import "./observability-init";

import { getSession } from "./session";

const logger = getLogger("route.admin");

/**
 * Guard + error mapping for back-office route handlers.
 *
 * Hiding a nav item is presentation; this is the control (docs/05 §4.3).
 * Every `/api/admin/*` handler starts with `requireBackOffice(permission)`
 * even though middleware already gated `/admin` on `admin:view` — that
 * check is coarse, and an `ar_manager` session must not be able to
 * approve a customer just because it can see the shell.
 */
export async function requireBackOffice(permission: Permission): Promise<SessionClaims> {
  const session = await requirePermission(await getSession(), permission);
  setContextTenant(session.tenantId, session.userId);
  return session;
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
  if (isLoyaltyError(error)) {
    // No `upstreamMessage`: a credit-limit request is portal-owned, and the
    // one SAP read behind it (the current limit) fails as an outage, not as a
    // business answer with SAP text worth passing on.
    return NextResponse.json(
      { error: error.message, issues: error.issues, code: error.code },
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
  if (isPaymentError(error)) {
    // `upstreamMessage` included: this is the reconciliation tray, an
    // operator screen, and a desk retrying a posting needs SAP's own words —
    // unlike a customer-facing payment error, which never carries it.
    return NextResponse.json(
      { error: error.message, code: error.code, upstreamMessage: error.upstreamMessage },
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

/** The admin-plane mirror of `handlePortal` — see its comment (docs/07 B3). */
export async function handleAdmin(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const requestId = (await headers()).get("x-request-id") ?? crypto.randomUUID();
  return runWithContext({ requestId }, async () => {
    const startedAt = Date.now();
    try {
      const response = await fn();
      logger.info(
        { status: response.status, durationMs: Date.now() - startedAt },
        "admin request handled",
      );
      return response;
    } catch (error) {
      logger.error({ err: error, durationMs: Date.now() - startedAt }, "admin request failed");
      captureException(error);
      return toAdminErrorResponse(error);
    }
  });
}
