import type { Permission, SessionClaims } from "@cc/domain";
import { captureException, getLogger, runWithContext, setContextTenant } from "@cc/observability";
import { isCatalogueError } from "@cc/service-catalogue";
import { isCustomerError } from "@cc/service-customer";
import { isDeliveryError } from "@cc/service-delivery";
import { AuthError, requirePermission } from "@cc/service-identity";
import { isInquiryError } from "@cc/service-inquiry";
import { isInvoiceError } from "@cc/service-invoice";
import { isLoyaltyError } from "@cc/service-loyalty";
import { isOrderError } from "@cc/service-order";
import { isPaymentError } from "@cc/service-payment";
import { isSupportError } from "@cc/service-support";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import "./observability-init";

import { getSession } from "./session";

const logger = getLogger("route.portal");

/**
 * Guard + error mapping for customer-plane route handlers.
 *
 * The mirror of `admin-route.ts`, with one deliberate difference: the raw
 * SAP message is *not* included in the response. A reviewer needs it to act;
 * a customer would only see a BAPIRET2 string they can do nothing with
 * (docs/06 engineering standards, docs/05 §11).
 */
export async function requirePortal(permission: Permission): Promise<SessionClaims> {
  const session = await requirePermission(await getSession(), permission);
  // Fills in the request context `handlePortal` opened, so every log line
  // for the rest of this request — including the one below — carries the
  // tenant (docs/07 B3).
  setContextTenant(session.tenantId, session.userId);
  return session;
}

export function toPortalErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    isCatalogueError(error) ||
    // Reaches this plane through `assertCustomerCanOrder` (ADR-057): a
    // deactivated account is a 409 with the domain's own wording, and was a
    // 500 until this line existed. No `upstreamMessage` here — see above.
    isCustomerError(error) ||
    isOrderError(error) ||
    isDeliveryError(error) ||
    isInquiryError(error) ||
    isInvoiceError(error) ||
    isLoyaltyError(error) ||
    isPaymentError(error) ||
    isSupportError(error)
  ) {
    return NextResponse.json(
      { error: error.message, issues: error.issues, code: error.code },
      { status: error.status },
    );
  }
  throw error;
}

/**
 * Every `/api/*` portal route calls this once, so it is the one place a
 * request id (set by `middleware.ts`, or generated here for the rare
 * handler middleware doesn't cover) becomes the request context every log
 * line and adapter span for the rest of the call reads from (docs/07 B3).
 */
export async function handlePortal(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const requestId = (await headers()).get("x-request-id") ?? crypto.randomUUID();
  return runWithContext({ requestId }, async () => {
    const startedAt = Date.now();
    try {
      const response = await fn();
      logger.info(
        { status: response.status, durationMs: Date.now() - startedAt },
        "portal request handled",
      );
      return response;
    } catch (error) {
      logger.error({ err: error, durationMs: Date.now() - startedAt }, "portal request failed");
      captureException(error);
      return toPortalErrorResponse(error);
    }
  });
}
