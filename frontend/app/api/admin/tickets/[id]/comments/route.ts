import { addAgentComment } from "@cc/service-support";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({
  body: z.string().trim().min(1, "Enter a message.").max(5000),
  /** `agent` marks an internal note — never selected by a customer read. */
  visibility: z.enum(["customer", "agent"]).default("customer"),
});

export const POST = route<{ id: string }>(
  { guard: { kind: "permission", permission: "support:resolve" } },
  async ({ request, params, session }) => {
    const input = await parseBody(request, schema);
    const ticket = await addAgentComment(
      { tenantId: session.tenantId, userId: session.userId },
      params.id,
      input.body,
      input.visibility,
    );
    return Response.json(ticket, { status: 201 });
  },
);
