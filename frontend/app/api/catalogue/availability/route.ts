import { getMaterialsAvailability } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({
  // Bounded: the grid asks for one page, and an unbounded list would be one
  // request that fans out into hundreds of SAP calls.
  materials: z
    .array(
      z.object({
        material: z.string().trim().min(1),
        quantity: z.coerce.number().positive().optional(),
      }),
    )
    .max(60),
  plant: z.string().trim().optional(),
});

/**
 * Price and stock for a page of cards, in one request.
 *
 * The per-card endpoint fired one request per tile; this is the batched form
 * the grid uses. Same guard, same KUNNR scoping — the batching is a transport
 * concern and changes nothing about who may see which price.
 */
export const POST = route(
  { guard: { kind: "permission", permission: "catalogue:view" } },
  async ({ request, session }) => {
    const { materials, plant } = await parseBody(request, schema);
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return {
      availability: await getMaterialsAvailability(
        adapter,
        requireKunnr(session),
        materials,
        plant,
      ),
    };
  },
);
