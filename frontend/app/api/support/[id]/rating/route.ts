import { TICKET_RATING_MAX, TICKET_RATING_MIN } from "@cc/domain";
import { rateTicket } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({
  rating: z.coerce.number().int().min(TICKET_RATING_MIN).max(TICKET_RATING_MAX),
  comment: z.string().trim().max(1000).optional(),
});

export const POST = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:create" } },
  async ({ request, params, session }) => {
    const input = await parseBody(request, schema);
    return rateTicket(
      { tenantId: session.tenantId, kunnr: requireKunnr(session), userId: session.userId },
      params.id,
      input,
    );
  },
);
