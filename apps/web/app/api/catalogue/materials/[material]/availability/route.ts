import { CatalogueError, getMaterialAvailability } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Per-card price + stock (docs/05 §7.2: "Price and stock lazily loaded per
 * card with skeletons (they're per-customer SAP calls)").
 *
 * Deliberately one material per request: the card that resolves first
 * renders first, and a slow condition record can't hold up the whole grid.
 */
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ material: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("catalogue:view");
    if (!session.kunnr) throw new CatalogueError("no_account");

    const { material } = await params;
    const url = new URL(request.url);
    const quantityParam = url.searchParams.get("quantity");
    const quantity = quantityParam ? Number(quantityParam) : undefined;

    const sap = await getSapAdapterForTenant(session.tenantId);
    const availability = await getMaterialAvailability(sap, session.kunnr, material, {
      quantity: Number.isFinite(quantity) && quantity! > 0 ? quantity : undefined,
      plant: url.searchParams.get("plant") ?? undefined,
    });

    return NextResponse.json({ availability });
  });
}
