import { listNotifications } from "@cc/service-notification";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The bell inbox (docs/05 §6.4, docs/07 A7).
 *
 * Guarded by `dashboard:view` — the permission every portal role holds and
 * no platform operator does. A notification carries no capability of its own:
 * it is a message already addressed to this user, and what it links to is
 * re-authorised by the route it points at when they click (docs/05 §4.3). A
 * dedicated `notification:view` permission would be one a tenant could
 * revoke to give somebody a bell that never rings, which is a worse product
 * than no bell.
 *
 * The session's user id is the only selector; the service takes it as a
 * required argument, so there is no shape of request that returns somebody
 * else's inbox.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("dashboard:view");

    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? "");

    return NextResponse.json(
      await listNotifications(
        { tenantId: session.tenantId, userId: session.userId },
        {
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
          unreadOnly: params.get("unread") === "true",
        },
      ),
    );
  });
}
