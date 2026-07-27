import { submitApplication } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handle, resolveDraftContext } from "@/lib/onboarding-route";

/**
 * Final submission. The system validation the process flow in docs/03
 * describes (full schema, GSTIN evidence, documents, duplicate guard) all
 * happens in the service — a 422 here comes back with field-level issues
 * the wizard shows inline.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id } = await params;

    const application = await submitApplication(tenantId, { applicationId: id, draftToken });
    return NextResponse.json({ application });
  });
}
