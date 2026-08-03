import { getCreditPosition } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's credit position (docs/03 Screen 9.1).
 *
 * Nothing is stored, so this is a pure composition of SAP reads and answers
 * with its freshness — the screen renders that rather than claiming "Live"
 * (ADR-007). The sold-to account comes from the session and never from the
 * query string: a credit limit is exactly the sort of number a caller would
 * like to ask about somebody else.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("account:view");
    const sap = await getSapAdapterForTenant(session.tenantId);

    return NextResponse.json(
      await getCreditPosition(sap, {
        tenantId: session.tenantId,
        kunnr: session.kunnr,
        userId: session.userId,
      }),
    );
  });
}
