import { customerDeactivationSchema } from "@cc/domain";
import { setCustomerAccountActive } from "@cc/service-customer";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Deactivate / reactivate a customer's portal access (ADR-057).
 *
 * One route carrying the target state rather than two verbs, exactly as the
 * operator console's tenant switch does (ADR-054): the two directions are
 * the same reversible decision, and pairing them makes it visible in the
 * route registry that deactivation is not a delete. There is no DELETE here
 * — the account's orders, deliveries and invoices are the portal's side of
 * documents SAP has already posted.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ kunnr: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:deactivate");
    const { kunnr } = await params;

    const parsed = customerDeactivationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { isActive: boolean }" }, { status: 400 });
    }

    const customer = await setCustomerAccountActive(session.tenantId, kunnr, {
      ...parsed.data,
      actorUserId: session.userId,
    });

    return NextResponse.json({ customer });
  });
}
