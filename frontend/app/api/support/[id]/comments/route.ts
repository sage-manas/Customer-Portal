import { addCustomerComment } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({ body: z.string().trim().min(1, "Enter a message.").max(5000) });

export const POST = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:create" } },
  async ({ request, params, session }) => {
    const input = await parseBody(request, schema);
    const ticket = await addCustomerComment(
      { tenantId: session.tenantId, kunnr: requireKunnr(session), userId: session.userId },
      params.id,
      input.body,
    );
    return Response.json(ticket, { status: 201 });
  },
);
