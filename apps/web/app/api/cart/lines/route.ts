import { cartLineWriteSchema } from "@cc/domain";
import { addToCart } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Add to cart. The body is parsed against the registry-derived schema here
 * *and* again in the service — the handler's parse produces a clean 422 for
 * a malformed request, the service's is the one that guarantees no caller
 * can bypass it (docs/05 §4.3, "the API enforces").
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("cart:manage");

    const parsed = cartLineWriteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before you can continue.",
          issues: parsed.error.issues.map((issue) => ({
            field: String(issue.path[0] ?? ""),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const cart = await addToCart(session.tenantId, session.kunnr, parsed.data, sap);
    return NextResponse.json({ cart }, { status: 201 });
  });
}
