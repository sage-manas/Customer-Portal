import { ONBOARDING_STEP_COUNT } from "@cc/domain";
import { saveStep } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { RouteError, handle, resolveDraftContext } from "@/lib/onboarding-route";

/**
 * Saves one wizard step. Validation is the service's (registry-derived);
 * this handler only parses the request and maps the error — ADR-002.
 */
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; step: string }> },
) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id, step } = await params;

    const stepNumber = Number(step);
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > ONBOARDING_STEP_COUNT) {
      throw new RouteError(404, "We couldn't find that step.");
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new RouteError(400, "Invalid request.");
    }

    const application = await saveStep(
      tenantId,
      { applicationId: id, draftToken },
      stepNumber,
      body as Record<string, unknown>,
    );
    return NextResponse.json({ application });
  });
}
