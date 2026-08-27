import { CatalogueError, getMaterialsAvailability } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Price + stock for a whole catalogue page in one request.
 *
 * The per-material route beside it still serves a single card; this is what
 * the grid uses, because one request per card ties the request count to the
 * page size. Each material is read independently inside the service, so one
 * that can't be read is simply absent from the response and its card renders
 * unpriced rather than taking the page down.
 *
 * A GET, despite the list of materials: it reads and writes nothing, and the
 * page is capped, so the selection fits a query string. Each `m` is
 * `MATNR` or `MATNR:quantity`.
 */
export const runtime = "nodejs";

const MAX_ITEMS = 48;

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("catalogue:view");
    if (!session.kunnr) throw new CatalogueError("no_account");

    const url = new URL(request.url);
    const items = url.searchParams
      .getAll("m")
      .slice(0, MAX_ITEMS)
      .map((entry) => {
        const separator = entry.lastIndexOf(":");
        const material = separator === -1 ? entry : entry.slice(0, separator);
        const quantity = separator === -1 ? NaN : Number(entry.slice(separator + 1));
        return { material, quantity: quantity > 0 ? quantity : undefined };
      })
      .filter((item) => item.material.length > 0);

    const sap = await getSapAdapterForTenant(session.tenantId);
    const availability = await getMaterialsAvailability(
      sap,
      session.kunnr,
      items,
      url.searchParams.get("plant") ?? undefined,
    );

    return NextResponse.json({ availability });
  });
}
