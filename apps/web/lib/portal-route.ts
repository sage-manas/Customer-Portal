import type { Permission, SessionClaims } from "@cc/domain";
import { isCatalogueError } from "@cc/service-catalogue";
import { isDeliveryError } from "@cc/service-delivery";
import { AuthError, requirePermission } from "@cc/service-identity";
import { isInvoiceError } from "@cc/service-invoice";
import { isOrderError } from "@cc/service-order";
import { isPaymentError } from "@cc/service-payment";
import { NextResponse } from "next/server";

import { getSession } from "./session";

/**
 * Guard + error mapping for customer-plane route handlers.
 *
 * The mirror of `admin-route.ts`, with one deliberate difference: the raw
 * SAP message is *not* included in the response. A reviewer needs it to act;
 * a customer would only see a BAPIRET2 string they can do nothing with
 * (docs/06 engineering standards, docs/05 §11).
 */
export async function requirePortal(permission: Permission): Promise<SessionClaims> {
  return requirePermission(await getSession(), permission);
}

export function toPortalErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    isCatalogueError(error) ||
    isOrderError(error) ||
    isDeliveryError(error) ||
    isInvoiceError(error) ||
    isPaymentError(error)
  ) {
    return NextResponse.json(
      { error: error.message, issues: error.issues, code: error.code },
      { status: error.status },
    );
  }
  throw error;
}

export async function handlePortal(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return toPortalErrorResponse(error);
  }
}
