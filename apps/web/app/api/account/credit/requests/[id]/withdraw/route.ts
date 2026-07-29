import { withdrawCreditRequest } from "@cc/service-loyalty";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Withdraw a request that hasn't been decided yet.
 *
 * The only transition a customer may make on their own request, and the route
 * asserts none of that itself: `CREDIT_REQUEST_TRANSITIONS` in `@cc/domain`
 * records who may make each move, and the service reads it — so a POST asking
 * to approve arrives at the same table that greys the button out.
 */
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("credit:request");
    const { id } = await params;

    return NextResponse.json(
      await withdrawCreditRequest(
        { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
        id,
      ),
    );
  });
}
