import { getMaterialAvailability } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { z } from "zod";

import { parseQuery } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const query = z.object({ quantity: z.coerce.number().positive().default(1) });

/**
 * Price and stock for one material, for this session's account.
 *
 * The KUNNR comes from the session: pricing is customer-specific, so a handler
 * that accepted one would let any customer read another's contracted price.
 */
export const GET = route<{ material: string }>(
  { guard: { kind: "permission", permission: "catalogue:view" } },
  async ({ url, params, session }) => {
    const { quantity } = parseQuery(url, query);
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return {
      availability: await getMaterialAvailability(
        adapter,
        requireKunnr(session),
        decodeURIComponent(params.material),
        { quantity },
      ),
    };
  },
);
