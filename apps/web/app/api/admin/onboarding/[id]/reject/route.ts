import { rejectApplication } from "@cc/service-onboarding";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/** Reject with reasons — mandatory, per docs/05 §7.1. */
export const runtime = "nodejs";

const bodySchema = z.object({ reasons: z.array(z.string()).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("onboarding:approve");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Give at least one reason for the rejection.",
          issues: [{ field: "reasons", message: "Give at least one reason for the rejection." }],
        },
        { status: 422 },
      );
    }

    const application = await rejectApplication(session.tenantId, id, {
      reasons: parsed.data.reasons,
      actorUserId: session.userId,
    });

    return NextResponse.json({ application });
  });
}
