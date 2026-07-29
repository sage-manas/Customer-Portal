import { ticketAssignSchema } from "@cc/domain";
import { assignTicket, getTicketForAgent } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * One ticket, back-office view (docs/05 §7.8) — internal notes included, and
 * no KUNNR check, because inside the tenant an agent handles every account.
 *
 * `PATCH` is assignment only (QMEL-VERAN). Status changes live next door under
 * `/status`, so a single generic "update the ticket" endpoint never exists to
 * be pointed at a field it shouldn't reach.
 *
 * Assignment currently accepts only **claim** (`@me`) and **release**
 * (`null`). Handing a ticket to a named colleague needs a check that the id
 * belongs to a back-office user *in this tenant*, and that lookup lives
 * behind `@cc/service-identity` — an app may not reach `@cc/db` (CLAUDE.md
 * rule 1), and an unchecked id here would let one tenant's ticket be assigned
 * to another tenant's user. Claim-and-release covers the workbench's actual
 * flow; reassignment arrives with that lookup rather than ahead of it.
 */
export const runtime = "nodejs";

/** The only non-null assignee the workbench may ask for: the caller. */
const CLAIM = "@me";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("support:resolve");
    const { id } = await params;

    return NextResponse.json(
      await getTicketForAgent({ tenantId: session.tenantId, userId: session.userId }, id),
    );
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("support:resolve");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketAssignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Unknown assignment." }, { status: 422 });
    }

    const requested = parsed.data.assigneeUserId;
    if (requested !== null && requested !== CLAIM) {
      return NextResponse.json(
        { error: "Tickets can be claimed or returned to the queue, not handed to someone else." },
        { status: 422 },
      );
    }

    return NextResponse.json(
      await assignTicket(
        { tenantId: session.tenantId, userId: session.userId },
        id,
        requested === CLAIM ? session.userId : null,
      ),
    );
  });
}
