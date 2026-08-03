import { ticketCommentSchema } from "@cc/domain";
import { addCustomerComment } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * A customer's reply on their own ticket (docs/05 §7.8 "threaded comments").
 *
 * Guarded by `support:create` rather than `support:view`: posting to a thread
 * commits the account to a statement, which is the same kind of act as
 * raising the ticket and not something a view-only login should do.
 *
 * `internal` is refused by the service for a customer session — not silently
 * dropped. A request asking for one is either a bug or a probe, and writing it
 * as visible instead would put the customer's words where the back office
 * keeps its own notes.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("support:create");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketCommentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Write a comment before posting.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const ticket = await addCustomerComment(
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      id,
      parsed.data,
    );

    return NextResponse.json(ticket, { status: 201 });
  });
}
