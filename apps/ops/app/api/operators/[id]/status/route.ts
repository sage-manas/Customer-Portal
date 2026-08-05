import { setOperatorActive } from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

const bodySchema = z.object({ isActive: z.boolean() });

/**
 * Deactivate / reactivate a console login. The acting operator's id is
 * taken from the session and passed to the service, which refuses both
 * self-deactivation and the last account that could undo it — the console
 * has no way back in from either.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    const operator = await requireOperator("platform:operators-manage");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { isActive: boolean }" }, { status: 400 });
    }

    return NextResponse.json({
      operator: await setOperatorActive(id, parsed.data.isActive, operator.operatorId),
    });
  });
}
