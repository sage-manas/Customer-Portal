import { payRefund } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Pay a credit note out (F-58) — the AP desk's refund action (ADR-059).
 *
 * The body carries nothing but an optional note: the amount comes from a
 * fresh read of the refund queue inside `payRefund`, because a desk screen is
 * a snapshot and a browser-supplied figure could pay out a credit that has
 * since been cleared against a new invoice. `initiatedBy` is the session's
 * user, never a request field — the whole point of carrying it is that SAP's
 * document names who authorised the payment.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("finance:ap");
    const { vbeln } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: string };

    const sap = await getSapAdapterForTenant(session.tenantId);
    const paid = await payRefund(sap, {
      vbeln,
      initiatedBy: session.userId,
      note: body.note,
    });

    return NextResponse.json(paid);
  });
}
