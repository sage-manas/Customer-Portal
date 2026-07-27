import { requestMoreInfo } from "@cc/service-onboarding";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * "Request More Info": sends the application back to the applicant with a
 * note. Needs `onboarding:review` rather than `onboarding:approve` — asking
 * for a missing certificate is review work, not a credit decision.
 */
export const runtime = "nodejs";

const bodySchema = z.object({ note: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("onboarding:review");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Tell the applicant what you need from them.",
          issues: [{ field: "note", message: "Tell the applicant what you need from them." }],
        },
        { status: 422 },
      );
    }

    const application = await requestMoreInfo(session.tenantId, id, {
      note: parsed.data.note,
      actorUserId: session.userId,
    });

    return NextResponse.json({ application });
  });
}
