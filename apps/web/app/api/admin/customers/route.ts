import { listCustomerAccounts } from "@cc/service-customer";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The tenant's customer directory (doc 09 §3.4).
 *
 * Guarded by `customer:register` — the same permission the Customers tab
 * declares, and the coarsest of the three `customer:*` leaves. All three are
 * held only by `client_admin`, so an AP or AR manager holding the admin
 * shell gets a 403 here even though the shell rendered for them.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");

    const params = new URL(request.url).searchParams;
    const status = params.get("status");

    const sap = await getSapAdapterForTenant(session.tenantId);
    const read = await listCustomerAccounts(session.tenantId, sap, {
      search: params.get("q") ?? undefined,
      status: status === "Active" || status === "Deactivated" ? status : undefined,
    });

    return NextResponse.json({
      customers: read.data,
      freshness: read.freshness,
      syncedAt: read.syncedAt,
    });
  });
}
