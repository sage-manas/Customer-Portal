import { getBackOfficeRegistration } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Reads a back-office registration back — what a refreshed wizard resumes
 * from. An application the back office did not start 404s here even for a
 * client admin: an applicant's own in-flight draft belongs to them, and the
 * queue screen is where that conversation happens (ADR-056).
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id } = await params;

    return NextResponse.json({
      application: await getBackOfficeRegistration(session.tenantId, id),
    });
  });
}
