import { cartQuantitySchema } from "@cc/domain";
import { removeCartLine, updateCartLine } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Edit or remove one cart line. A line id belonging to another account —
 * even inside the same tenant — is a 404, never a 403 (CLAUDE.md rule 5);
 * the service scopes the update by the session's own cart, so a guessed id
 * matches nothing.
 */
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("cart:manage");
    const { lineId } = await params;

    const parsed = cartQuantitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before you can continue.",
          issues: parsed.error.issues.map((issue) => ({
            field: String(issue.path[0] ?? "quantity"),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const cart = await updateCartLine(
      session.tenantId,
      session.kunnr,
      lineId,
      parsed.data.quantity,
      sap,
    );
    return NextResponse.json({ cart });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ lineId: string }> },
) {
  return handlePortal(async () => {
    const session = await requirePortal("cart:manage");
    const { lineId } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    const cart = await removeCartLine(session.tenantId, session.kunnr, lineId, sap);
    return NextResponse.json({ cart });
  });
}
