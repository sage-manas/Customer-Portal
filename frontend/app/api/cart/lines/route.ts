import { cartLineWriteSchema } from "@cc/domain";
import { addToCart } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * Validated with the domain's own schema rather than one written here — it is
 * derived from the SAP field registry, so the material's length and pattern
 * rules match what SAP will accept.
 */
export const POST = route(
  { guard: { kind: "permission", permission: "cart:manage" } },
  async ({ request, session }) => {
    const input = await parseBody(request, cartLineWriteSchema);
    const adapter = await getSapAdapterForTenant(session.tenantId);
    const cart = await addToCart(adapter, session.tenantId, requireKunnr(session), input);
    return Response.json({ cart }, { status: 201 });
  },
);
