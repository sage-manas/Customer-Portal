import { searchMaterials } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Match code over MATNR / MAKTX / MATKL for the catalogue's search box.
 *
 * The matching is the query and lives in the service, not the browser: the
 * screen used to filter a full unfiltered item dump client-side, which grew
 * with the catalogue and shipped on every render regardless of what was
 * typed. The material master is tenant-wide and carries no customer data,
 * so this needs no sold-to account.
 */
export const runtime = "nodejs";

const LIMIT = 12;

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("catalogue:view");

    const term = new URL(request.url).searchParams.get("q") ?? "";
    const sap = await getSapAdapterForTenant(session.tenantId);

    return NextResponse.json({ materials: await searchMaterials(sap, term, LIMIT) });
  });
}
