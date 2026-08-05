import { podConfirmSchema } from "@cc/domain";
import { confirmReceipt, getPodFormDefaults } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Proof of delivery (docs/03 Screen 5.2, docs/05 §7.5).
 *
 * `delivery:view` reads the form's defaults; `delivery:confirm-receipt`
 * submits it. The `customer` role holds both since the collapse (ADR-061),
 * so the split buys nothing today and is kept anyway: signing for goods is a
 * commitment, reading a shipment is not, and the seam a narrower buyer role
 * would need is cheaper to keep than to re-cut (docs/05 §4.3).
 *
 * There is one POST, not two. Doc 05 draws "Confirm Receipt" and "Report
 * Discrepancy" as two buttons, but which one *happened* is decided by the
 * quantities the customer submitted, not by which button they pressed — the
 * service compares them against what was dispatched and records what is true.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("delivery:view");
    const { vbeln } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await getPodFormDefaults(sap, session.kunnr, vbeln));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("delivery:confirm-receipt");
    const { vbeln } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = podConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before we can record this receipt.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await confirmReceipt(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      vbeln,
      parsed.data,
    );

    return NextResponse.json(result, { status: 201 });
  });
}
