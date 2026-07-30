import { markNotificationsRead } from "@cc/service-notification";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Marking notifications read — `{ ids: [...] }` for some, `{}` for all.
 *
 * A POST rather than a PATCH per id: clearing a bell is one action on a
 * list, and the panel's "Mark all read" would otherwise be twenty requests.
 * Idempotent, and an id that isn't the caller's simply doesn't match — the
 * service never confirms that somebody else's notification exists.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("dashboard:view");
    const body = (await request.json().catch(() => ({}))) as unknown;

    return NextResponse.json(
      await markNotificationsRead({ tenantId: session.tenantId, userId: session.userId }, body),
    );
  });
}
