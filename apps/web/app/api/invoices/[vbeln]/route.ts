import { getInvoice } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * One billing document, with its tax split, FI position and O2C timeline.
 *
 * The VBELN in the path is not trusted to belong to the caller: the service
 * compares it to the session's KUNNR and answers 404 when it doesn't —
 * identical to the answer for an invoice number that never existed
 * (CLAUDE.md rule 5).
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("invoice:view");
    const { vbeln } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await getInvoice(sap, session.kunnr, vbeln));
  });
}
