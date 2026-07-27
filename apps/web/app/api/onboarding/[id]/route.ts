import { getDraftApplication } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handle, resolveDraftContext } from "@/lib/onboarding-route";

/** Reads the applicant's own application — the wizard and `/register/status`. */
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id } = await params;

    const application = await getDraftApplication(tenantId, {
      applicationId: id,
      draftToken,
    });
    return NextResponse.json({ application });
  });
}
