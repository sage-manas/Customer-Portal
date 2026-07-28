import { cancelOrder } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Cancel an order (docs/05 §7.4 — offered only while GBSTK=A, confirmed in
 * a dialog that states the SAP consequence per §6.2).
 *
 * `order:cancel` is its own permission: withdrawing an order a colleague
 * placed is not the same trust as placing one. The service re-reads the
 * order's status from SAP before acting, so a stale screen cannot cancel an
 * order that has since shipped.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("order:cancel");
    const { vbeln } = await params;

    const body = (await request.json().catch(() => null)) as { reason?: string } | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim() || undefined : undefined;

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json({ order: await cancelOrder(sap, session.kunnr, vbeln, reason) });
  });
}
