import { assertCustomerCanOrder } from "@cc/service-customer";
import { acceptQuotation, acceptQuotationSchema } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * "Accept & Convert to Order" (docs/03 Screen 3.2, docs/05 §7.3) — VA01 with
 * reference to the quotation, so SAP's copy control carries the quoted prices.
 *
 * `quotation:accept` is its own permission, separate from `order:create`: the
 * commercial decision a customer makes here is to accept a price somebody
 * already negotiated, which is not the same trust as composing an order from
 * scratch.
 *
 * The service re-reads the quotation from SAP and re-derives its validity
 * before converting, so a page that has been open since before the quotation
 * lapsed cannot push it through — and a quotation belonging to another
 * customer answers 404, exactly as one that never existed does.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("quotation:accept");
    const { vbeln } = await params;

    const parsed = acceptQuotationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before we can turn this into an order.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    // Accepting a quotation creates a sales order, so it is refused for a
    // deactivated account for the same reason `POST /api/orders` is
    // (ADR-057) — the second door into the same room.
    if (session.kunnr) await assertCustomerCanOrder(session.tenantId, session.kunnr);

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await acceptQuotation(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      vbeln,
      parsed.data,
    );

    return NextResponse.json(result, { status: 201 });
  });
}
