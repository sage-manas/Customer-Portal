import { searchMaterials } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { z } from "zod";

import { parseBody } from "@/server/http/respond";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const schema = z.object({ q: z.string().trim().max(80).optional() });

/** How many hits the typeahead shows. */
const LIMIT = 12;

/**
 * Typeahead over the material master.
 *
 * Server-side, and capped: the alternative the UI once had was shipping the
 * whole master to the browser and filtering there, which leaks the full
 * catalogue and scales with the tenant's product count rather than the
 * viewport.
 *
 * An empty term returns nothing rather than everything — a blank box must not
 * be a "select all".
 */
export const POST = route(
  { guard: { kind: "permission", permission: "catalogue:view" } },
  async ({ request, session }) => {
    const { q } = await parseBody(request, schema);
    if (!q) return { materials: [] };

    const adapter = await getSapAdapterForTenant(session.tenantId);
    return { materials: await searchMaterials(adapter, q, LIMIT) };
  },
);
