import { clearCart, getCart } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The cart (docs/05 §7.2).
 *
 * `catalogue:view` reads it, `cart:manage` changes it — a session holding
 * only the former can see what its colleagues have staged but not touch it.
 * The
 * KUNNR comes from the session, never from the request: a cart is addressed
 * by *who is asking*, so there is no id to tamper with.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("catalogue:view");
    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json({ cart: await getCart(session.tenantId, session.kunnr, sap) });
  });
}

export async function DELETE() {
  return handlePortal(async () => {
    const session = await requirePortal("cart:manage");
    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json({ cart: await clearCart(session.tenantId, session.kunnr, sap) });
  });
}
