import { releaseCreditBlock } from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Release a credit-blocked order (VKM3) — the AR desk's action.
 *
 * Guarded by `credit:release`, which `ar_manager` and `client_admin` hold and
 * `ap_manager` does not: releasing an order applies the limit that exists,
 * which is AR's desk, while changing a limit is `credit:decide-limit`.
 *
 * **200 with `released: false` is a normal response.** VKM3 re-runs the credit
 * check, and an order still over its limit stays held; that is an answer, not
 * a failure, and the screen renders SAP's reason (ADR-059).
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("credit:release");
    const { vbeln } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: string };

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await releaseCreditBlock(sap, {
      vbeln,
      initiatedBy: session.userId,
      note: body.note,
    });

    return NextResponse.json(result);
  });
}
