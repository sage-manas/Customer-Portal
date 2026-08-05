import { getGstnAdapterForTenant, verifyBackOfficeGstin } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * GSTIN verification for a back-office registration.
 *
 * The tenant admin verifies the number against GSTN exactly as the applicant
 * would: registering *on behalf of* a customer must not mean registering
 * them with unverified statutory details (ADR-010 still applies — the
 * evidence belongs to the number, not to who typed it).
 */
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id } = await params;

    const gstn = await getGstnAdapterForTenant(session.tenantId);
    return NextResponse.json({
      verification: await verifyBackOfficeGstin(session.tenantId, id, gstn),
    });
  });
}
