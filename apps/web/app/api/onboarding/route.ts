import { startApplication } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handle, resolveTenantId } from "@/lib/onboarding-route";

/**
 * Starts an onboarding application. Public by necessity — the applicant is
 * not a portal user yet — but tenant-scoped by host, and the draft token
 * returned here is the only handle to the record afterwards (ADR-009).
 */
export const runtime = "nodejs";

export async function POST() {
  return handle(async () => {
    const tenantId = await resolveTenantId();
    const { application, draftToken } = await startApplication(tenantId);

    return NextResponse.json({ application, draftToken }, { status: 201 });
  });
}
