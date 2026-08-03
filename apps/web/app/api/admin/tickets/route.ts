import { isTicketCategory, isTicketPriority } from "@cc/domain";
import { listWorkbench, type WorkbenchFilter } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The ticket workbench queue (docs/07 A3 "admin ticket workbench
 * `/admin/tickets` (SLA-sorted)").
 *
 * `support:resolve`, not `support:view`. The difference is the whole point of
 * the separate plane: this endpoint returns **every account's** tickets in the
 * tenant, which is exactly what a customer-plane permission must never buy.
 * Middleware gating `/admin` on `admin:view` is coarse; this is the control
 * (docs/05 §4.3).
 */
export const runtime = "nodejs";

const FILTERS: readonly WorkbenchFilter[] = ["open", "unassigned", "mine", "breached", "all"];

export async function GET(request: Request) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("support:resolve");

    const params = new URL(request.url).searchParams;
    const requested = params.get("filter");
    const category = params.get("category");
    const priority = params.get("priority");

    return NextResponse.json(
      await listWorkbench(
        { tenantId: session.tenantId, userId: session.userId },
        {
          filter: FILTERS.find((f) => f === requested) ?? "open",
          category: category && isTicketCategory(category) ? category : undefined,
          priority: priority && isTicketPriority(priority) ? priority : undefined,
        },
      ),
    );
  });
}
