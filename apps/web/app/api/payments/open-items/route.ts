import { listPayableItems } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Open items the customer can select on Make Payment step 1 (docs/05 §7.7).
 *
 * Read with `payment:view` rather than `payment:pay`: knowing what the
 * account owes is part of seeing the statement. The permission that matters
 * is on the POST that moves money.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("payment:view");

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await listPayableItems(sap, session.kunnr));
  });
}
