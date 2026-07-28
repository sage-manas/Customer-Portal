import { listDeliveries, type DeliveryStatusFilter } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's shipments (docs/03 Module 5).
 *
 * Nothing is stored: SAP owns delivery documents, so this is a composed read
 * that carries its own freshness (ADR-016). The KUNNR the list is keyed on
 * comes from the session, never from the query string.
 */
export const runtime = "nodejs";

const FILTERS: readonly DeliveryStatusFilter[] = ["all", "inTransit", "delivered", "awaitingPod"];

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("delivery:view");

    const requested = new URL(request.url).searchParams.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "all";

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await listDeliveries(sap, session.kunnr, { filter }));
  });
}
