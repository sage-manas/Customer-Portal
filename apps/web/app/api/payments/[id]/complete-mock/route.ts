import { completeMockCheckout, getPayment, getPaymentGatewayForTenant } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The mock gateway's "customer finished checkout" button (docs/05 §7.7 step
 * 3). Stands in for the redirect back from Razorpay in dev and demo.
 *
 * It does not mark anything paid itself: it asks the mock driver for a
 * properly signed webhook and delivers it through the same handler the real
 * gateway will use, so signature verification, deduplication and the SAP
 * posting are all exercised on the dev path. The service refuses this
 * outright unless the tenant is on the `mock` driver.
 */
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("payment:pay");
    const { id } = await params;

    // Resolved through the service so the sold-to check runs first: the
    // reference is only usable by someone who may see the payment.
    const payment = await getPayment(session.tenantId, session.kunnr, id);

    const [sap, gateway] = await Promise.all([
      getSapAdapterForTenant(session.tenantId),
      getPaymentGatewayForTenant(session.tenantId),
    ]);

    const result = await completeMockCheckout(session.tenantId, payment.gatewayReference ?? "", {
      sap,
      gateway,
    });

    return NextResponse.json(result);
  });
}
