import { getLoyaltyPosition } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Tier, YTD purchases and rebates (docs/03 Screen 9.2).
 *
 * The tier is computed on this call from VBRK over the fiscal year and the
 * tenant's thresholds — it is not stored, so there is no "current tier" that
 * could be read instead and no moment at which one changes.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("account:view");
    const sap = await getSapAdapterForTenant(session.tenantId);

    return NextResponse.json(
      await getLoyaltyPosition(sap, {
        tenantId: session.tenantId,
        kunnr: session.kunnr,
        userId: session.userId,
      }),
    );
  });
}
