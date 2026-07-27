import { OnboardingError, isOnboardingError } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { resolveRequestTenant } from "./tenant";

/**
 * Shared plumbing for the public onboarding endpoints.
 *
 * The applicant has no session, so these routes are public — but never
 * *unscoped*: the tenant comes from the host, and the application is
 * addressed by an unguessable draft token (ADR-009). Both are resolved here
 * so no individual handler can forget one.
 */

export const DRAFT_TOKEN_HEADER = "x-draft-token";

export interface OnboardingRouteContext {
  tenantId: string;
  draftToken: string;
}

export class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function resolveTenantId(): Promise<string> {
  const tenant = await resolveRequestTenant();
  if (!tenant) throw new RouteError(404, "We couldn't find a portal at this address.");
  return tenant.id;
}

export async function resolveDraftContext(request: Request): Promise<OnboardingRouteContext> {
  const draftToken = request.headers.get(DRAFT_TOKEN_HEADER);
  // A missing token is treated exactly like a wrong one: 404, so probing
  // application ids reveals nothing (CLAUDE.md rule 5).
  if (!draftToken) throw new RouteError(404, "We couldn't find that application.");
  return { tenantId: await resolveTenantId(), draftToken };
}

/**
 * Maps a thrown error to a response. `OnboardingError` already carries
 * user-safe copy and field-level issues, so handlers never write their own —
 * and `upstreamMessage` (raw SAP/GSTN text) is deliberately not included in
 * the body.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof RouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (isOnboardingError(error)) {
    return NextResponse.json(
      { error: error.message, issues: error.issues, code: error.code },
      { status: error.status },
    );
  }
  throw error;
}

/** Wraps a handler so every route maps errors the same way. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return toErrorResponse(error);
  }
}

export { OnboardingError };
