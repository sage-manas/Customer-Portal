import { settleRebate } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Settle a rebate agreement (VB(7) — the AP desk's settlement action.
 *
 * Refused unless SAP has released the agreement for settlement: releasing is
 * VBO2's job and stays there, so the portal performs the settlement run and
 * not the decision to allow it (ADR-059).
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agreement: string }> },
) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("finance:ap");
    const { agreement } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: string };

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await settleRebate(sap, {
      agreementNumber: agreement,
      initiatedBy: session.userId,
      note: body.note,
    });

    return NextResponse.json(result);
  });
}
