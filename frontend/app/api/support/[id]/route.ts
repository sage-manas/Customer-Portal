import { getTicket } from "@cc/service-support";

import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:view" } },
  async ({ params, session }) =>
    getTicket(
      { tenantId: session.tenantId, kunnr: requireKunnr(session), userId: session.userId },
      params.id,
    ),
);
