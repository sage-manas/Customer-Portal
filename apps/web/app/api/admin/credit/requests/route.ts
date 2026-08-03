import { listCreditRequestQueue, type CreditQueueFilter } from "@cc/service-loyalty";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The credit desk's queue (docs/05 §8).
 *
 * Tenant-wide, and reached only through `credit:decide-limit`. It is a
 * different service function from the customer's list rather than the same one
 * with the KUNNR left off — ADR-032's rule, applied to the portal's own rows
 * instead of a SAP read: a boundary that depends on a caller omitting an
 * argument is not a boundary.
 */
export const runtime = "nodejs";

const FILTERS: readonly CreditQueueFilter[] = ["pending", "decided", "all"];

export async function GET(request: Request) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("credit:decide-limit");

    const requested = new URL(request.url).searchParams.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "pending";

    return NextResponse.json(
      await listCreditRequestQueue(
        { tenantId: session.tenantId, userId: session.userId },
        { filter },
      ),
    );
  });
}
