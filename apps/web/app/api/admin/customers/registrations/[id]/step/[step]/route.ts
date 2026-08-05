import { ONBOARDING_STEP_COUNT } from "@cc/domain";
import { saveBackOfficeStep } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Saves one wizard step of a back-office registration. Same registry, same
 * schemas, same service implementation as the public wizard — only the
 * credential differs (ADR-056).
 */
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; step: string }> },
) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id, step } = await params;

    const stepNumber = Number(step);
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > ONBOARDING_STEP_COUNT) {
      return NextResponse.json({ error: "We couldn't find that step." }, { status: 404 });
    }

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const application = await saveBackOfficeStep(
      session.tenantId,
      id,
      stepNumber,
      body as Record<string, unknown>,
    );

    return NextResponse.json({ application });
  });
}
