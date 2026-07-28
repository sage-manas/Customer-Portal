import { getPayment } from "@cc/service-payment";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * One payment — what the receipt screen and the Pending polling banner read
 * (docs/05 §7.7 return states).
 *
 * Scoped to the session's sold-to account: a colleague on the same KUNNR may
 * see a payment they didn't make (payments belong to the account, like the
 * cart — ADR-014), nobody else can, and the answer for someone else's is a
 * 404.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("payment:view");
    const { id } = await params;

    return NextResponse.json(await getPayment(session.tenantId, session.kunnr, id));
  });
}
