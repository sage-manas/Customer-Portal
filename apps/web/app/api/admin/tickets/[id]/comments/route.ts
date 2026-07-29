import { ticketCommentSchema } from "@cc/domain";
import { addAgentComment } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * An agent's reply, or an internal note (docs/05 §7.8).
 *
 * This is the only endpoint in the portal that may write `internal: true`.
 * The customer-plane one refuses the flag outright, so the capability lives
 * behind `support:resolve` and nowhere else — an agent posts both kinds from
 * the same box with a toggle, and the flag comes from the parsed body because
 * here it is a genuine choice rather than a claim to be distrusted.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("support:resolve");
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

    return NextResponse.json(
      await addAgentComment(
        { tenantId: session.tenantId, userId: session.userId },
        id,
        parsed.data,
      ),
      { status: 201 },
    );
  });
}
