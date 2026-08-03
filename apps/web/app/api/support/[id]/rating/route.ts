import { ticketRatingSchema } from "@cc/domain";
import { rateTicket } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * CSAT (docs/03 Screen 8.2 "Rate (CSAT)", docs/05 §7.8 "Rate Resolution (1–5
 * stars + comment)").
 *
 * Once, and only once there is a resolution to judge — both enforced by the
 * service via `canRateTicket`, because a rating is the one thing on a ticket
 * a customer cannot revise, and "you've already rated this" is a business
 * answer rather than a validation error.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("support:create");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketRatingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Rate the resolution from 1 to 5.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const ticket = await rateTicket(
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      id,
      parsed.data,
    );

    return NextResponse.json(ticket);
  });
}
