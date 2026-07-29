import { getTicket } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * One ticket, customer view (docs/05 §7.8 "Track").
 *
 * A ticket that isn't this customer's answers **404**, not 403 — the portal
 * must not confirm that another account's ticket exists (CLAUDE.md rule 5).
 * The service does that check; this handler only supplies the session's KUNNR.
 *
 * Internal notes never reach here: the customer read excludes them in the
 * query, so there is nothing on this response to filter.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("support:view");
    const { id } = await params;

    return NextResponse.json(
      await getTicket(
        { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
        id,
      ),
    );
  });
}
