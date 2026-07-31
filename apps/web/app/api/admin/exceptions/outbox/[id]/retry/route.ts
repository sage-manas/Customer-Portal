import { requeueOutboxEvent } from "@cc/service-reconciliation";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The exception tray's manual retry for a failed outbox row (docs/07 B4).
 *
 * Gives the row exactly one more relay attempt — it does not reset
 * `attempts`, so a row that fails again lands back in `failed` after a
 * single try rather than a fresh run of all five (see
 * `@cc/service-reconciliation`'s README).
 */
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("exceptions:view");
    const { id } = await params;

    const requeued = await requeueOutboxEvent(session.tenantId, id);
    if (!requeued) {
      return NextResponse.json(
        { error: "That event is no longer failed — it may already have relayed." },
        { status: 409 },
      );
    }

    return NextResponse.json({ requeued: true });
  });
}
