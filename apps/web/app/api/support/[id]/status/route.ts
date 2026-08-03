import { ticketTransitionSchema } from "@cc/domain";
import { transitionTicketAsCustomer } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Close or reopen, as the customer (docs/05 §7.8 "Reopen (within 7 days of
 * resolve)").
 *
 * The route names no transitions of its own. Which moves a customer may make
 * is a table in `@cc/domain` (`TICKET_TRANSITIONS`, actor `customer`), and the
 * service reads it — so a request asking to jump straight to `resolved` is
 * refused by the same lookup that greys the button out, rather than by a
 * second rule written here that could drift from the first.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("support:create");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Unknown ticket action." }, { status: 422 });
    }

    const ticket = await transitionTicketAsCustomer(
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      id,
      parsed.data.to,
    );

    return NextResponse.json(ticket);
  });
}
