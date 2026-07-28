import { getDelivery } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * One shipment, with its stepper, its O2C chain and the stored POD if the
 * customer has signed for it.
 *
 * The VBELN in the path is not trusted to belong to the caller: the service
 * compares LIKP-KUNAG to the session's KUNNR and answers 404 when it doesn't
 * — identical to the answer for a delivery number that never existed
 * (CLAUDE.md rule 5).
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("delivery:view");
    const { vbeln } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(
      await getDelivery(sap, { tenantId: session.tenantId, kunnr: session.kunnr }, vbeln),
    );
  });
}
