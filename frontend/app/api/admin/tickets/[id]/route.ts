import { assignTicket, getTicketForAgent } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** `null` unassigns; an absent field means "assign to me". */
const assignSchema = z.object({ assigneeUserId: z.string().trim().nullish() });

export const GET = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:resolve" } },
  async ({ params, session }) =>
    getTicketForAgent({ tenantId: session.tenantId, userId: session.userId }, params.id),
);

export const PATCH = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:resolve" } },
  async ({ request, params, session }) => {
    const { assigneeUserId } = await parseBody(request, assignSchema);
    return assignTicket(
      { tenantId: session.tenantId, userId: session.userId },
      params.id,
      assigneeUserId === null ? null : (assigneeUserId ?? session.userId),
    );
  },
);
