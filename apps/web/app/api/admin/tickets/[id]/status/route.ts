import { ticketResolveSchema, ticketTransitionSchema } from "@cc/domain";
import { resolveTicket, transitionTicketAsAgent } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * An agent moving a ticket (docs/03 Screen 8.2, docs/05 §7.8).
 *
 * Resolving is the same endpoint but a different call, because resolving is
 * not just a status: doc 03 Screen 8.2 requires resolution notes, and the
 * customer's 7-day reopen window and CSAT prompt both start from it. The
 * service refuses `to: "resolved"` without the text rather than storing an
 * empty resolution the customer then reads.
 *
 * Which moves are legal is `TICKET_TRANSITIONS` with actor `agent`, read by
 * the service — the same table the workbench draws its buttons from.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("support:resolve");
    const { id } = await params;
    const context = { tenantId: session.tenantId, userId: session.userId };

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Unknown ticket action." }, { status: 422 });
    }

    if (parsed.data.to === "resolved") {
      const resolution = ticketResolveSchema.safeParse(body);
      if (!resolution.success) {
        return NextResponse.json(
          {
            error: "Say what was done to resolve this — the customer sees this text.",
            issues: resolution.error.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          },
          { status: 422 },
        );
      }
      return NextResponse.json(await resolveTicket(context, id, resolution.data));
    }

    return NextResponse.json(await transitionTicketAsAgent(context, id, parsed.data.to));
  });
}
