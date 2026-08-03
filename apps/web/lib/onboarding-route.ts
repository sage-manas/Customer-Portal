import { captureException, getLogger, runWithContext, setContextTenant } from "@cc/observability";
import { OnboardingError, isOnboardingError } from "@cc/service-onboarding";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import "./observability-init";

import { resolveRequestTenant } from "./tenant";

const logger = getLogger("route.onboarding");

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
  // The applicant has no session, so this — not `requirePortal`'s
  // `setContextTenant` call — is where an onboarding request's logs and
  // adapter spans pick up a tenant (docs/07 B3).
  setContextTenant(tenant.id);
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

/** Wraps a handler so every route maps errors the same way, and carries request context (docs/07 B3). */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  const requestId = (await headers()).get("x-request-id") ?? crypto.randomUUID();
  return runWithContext({ requestId }, async () => {
    const startedAt = Date.now();
    try {
      const response = await fn();
      logger.info(
        { status: response.status, durationMs: Date.now() - startedAt },
        "onboarding request handled",
      );
      return response;
    } catch (error) {
      logger.error({ err: error, durationMs: Date.now() - startedAt }, "onboarding request failed");
      captureException(error);
      return toErrorResponse(error);
    }
  });
}

export { OnboardingError };
