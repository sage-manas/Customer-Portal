import { creditRequestDecisionSchema } from "@cc/domain";
import { decideCreditRequest } from "@cc/service-loyalty";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Approve or decline a credit-limit request (docs/05 §8).
 *
 * Worth being plain about what this does *not* do: it records the desk's
 * decision and nothing else. KNKK-KLIMK is maintained in FD32, the adapter has
 * no method that writes it, and the customer's limit is unchanged until
 * somebody in the tenant applies it (ADR-035). The screen says so, and so does
 * the notification.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("credit:decide-limit");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = creditRequestDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "That decision needs fixing before we can record it.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      await decideCreditRequest(
        { tenantId: session.tenantId, userId: session.userId },
        id,
        parsed.data,
      ),
    );
  });
}
