import { TICKET_STATUSES } from "@cc/domain";
import { resolveTicket, transitionTicketAsAgent } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * Resolving carries the customer-visible resolution text, so it is a different
 * move from a plain transition and the body says which one is meant.
 */
const schema = z.union([
  z.object({ resolution: z.string().trim().min(1, "Describe the resolution.").max(5000) }),
  z.object({ to: z.enum(TICKET_STATUSES) }),
]);

export const POST = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:resolve" } },
  async ({ request, params, session }) => {
    const input = await parseBody(request, schema);
    const agent = { tenantId: session.tenantId, userId: session.userId };

    return "resolution" in input
      ? resolveTicket(agent, params.id, input.resolution)
      : transitionTicketAsAgent(agent, params.id, input.to);
  },
);
