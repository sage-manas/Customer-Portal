import { getPaymentGatewayForTenant, reconcilePayment } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The exception tray's manual retry for a stuck payment (docs/07 B4).
 *
 * The same `reconcilePayment` the worker's automatic sweep calls on a
 * schedule (ADR-044) — this route exists so an operator doesn't have to
 * wait for the next tick. `requireBackOffice("exceptions:view")`, not a
 * separate `:resolve` permission: only `client_admin` and `ap_manager` hold `exceptions:view`
 * at all, so there is no narrower plane to split it from.
 */
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("exceptions:view");
    const { id } = await params;

    const [sap, gateway] = await Promise.all([
      getSapAdapterForTenant(session.tenantId),
      getPaymentGatewayForTenant(session.tenantId),
    ]);

    return NextResponse.json(await reconcilePayment(session.tenantId, id, { sap, gateway }));
  });
}
