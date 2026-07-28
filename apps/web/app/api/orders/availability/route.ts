import { checkAvailability } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * "Check Availability (ATP)" (docs/05 §7.4). A simulation: it creates
 * nothing, which is why it sits on its own route rather than as a mode of
 * POST /api/orders — a button that might place an order is not a button
 * anyone presses twice.
 *
 * It needs `order:create` rather than `order:view`: the confirmed quantities
 * and dates it returns are a pricing/availability quote for this account,
 * not a document the account already holds.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("order:create");

    const body = (await request.json().catch(() => null)) as Parameters<
      typeof checkAvailability
    >[2];

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await checkAvailability(sap, session.kunnr, body));
  });
}
