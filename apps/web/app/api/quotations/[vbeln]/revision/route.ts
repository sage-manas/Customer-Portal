import { requestRevision, revisionRequestSchema } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * "Request Revision" (docs/05 §7.3) — and the same endpoint behind an expired
 * quotation's "Request revalidation", because it is the same message to the
 * same sales desk. Two routes differing only in their label would be two
 * places to keep one rule.
 *
 * `inquiry:create` guards it rather than `quotation:accept`: asking for a
 * different price commits the account to nothing, which is exactly the trust a
 * buyer who may raise an inquiry already holds.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:create");
    const { vbeln } = await params;

    const parsed = revisionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Tell the sales team what needs to change before sending this.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const view = await requestRevision(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      vbeln,
      parsed.data,
    );

    return NextResponse.json({ quotation: view.quotation }, { status: 201 });
  });
}
