import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@cc/domain";
import { listWorkbench } from "@cc/service-support";
import { z } from "zod";

import { parseQuery } from "@/server/http/respond";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const query = z.object({
  filter: z.enum(["open", "unassigned", "mine", "breached", "all"]).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

/**
 * The agent workbench: tenant-wide, bounded by `tenantId` alone.
 *
 * A separate handler from the customer's `/api/support` rather than the same
 * one with a flag — dropping an argument must not be able to turn a customer
 * read into a tenant-wide one.
 */
export const GET = route(
  { guard: { kind: "permission", permission: "support:resolve" } },
  async ({ url, session }) =>
    listWorkbench({ tenantId: session.tenantId, userId: session.userId }, parseQuery(url, query)),
);
