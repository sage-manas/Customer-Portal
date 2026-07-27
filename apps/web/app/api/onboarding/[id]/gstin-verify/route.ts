import { getGstnAdapterForTenant, verifyApplicationGstin } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handle, resolveDraftContext } from "@/lib/onboarding-route";

/**
 * Live GSTIN verification for step 2 (docs/05 §7.1). The tenant's GSTN
 * driver is resolved by the service; the app never touches the adapters
 * layer (CLAUDE.md rule 1).
 *
 * An unverified GSTIN is a 200 with an outcome, not an error — the wizard
 * renders "cancelled", "not found" and "GSTN unreachable" as states.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id } = await params;

    const gstn = await getGstnAdapterForTenant(tenantId);
    const verification = await verifyApplicationGstin(
      tenantId,
      { applicationId: id, draftToken },
      gstn,
    );

    return NextResponse.json({ verification });
  });
}
