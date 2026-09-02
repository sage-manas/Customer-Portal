import { TICKET_STATUSES } from "@cc/domain";
import { transitionTicketAsCustomer } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({ to: z.enum(TICKET_STATUSES) });

/**
 * Which moves a customer may make is the transition table's answer, not this
 * handler's — it passes `to` through and the service refuses anything the
 * table does not permit (a customer may close and reopen, never resolve).
 */
export const POST = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:create" } },
  async ({ request, params, session }) => {
    const { to } = await parseBody(request, schema);
    return transitionTicketAsCustomer(
      { tenantId: session.tenantId, kunnr: requireKunnr(session), userId: session.userId },
      params.id,
      to,
    );
  },
);
