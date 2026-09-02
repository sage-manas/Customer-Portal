import { cartQuantitySchema } from "@cc/domain";
import { removeCartLine, updateCartLine } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";

import { parseBody } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

export const PATCH = route<{ lineId: string }>(
  { guard: { kind: "permission", permission: "cart:manage" } },
  async ({ request, params, session }) => {
    const { quantity } = await parseBody(request, cartQuantitySchema);
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return {
      cart: await updateCartLine(
        adapter,
        session.tenantId,
        requireKunnr(session),
        params.lineId,
        quantity,
      ),
    };
  },
);

export const DELETE = route<{ lineId: string }>(
  { guard: { kind: "permission", permission: "cart:manage" } },
  async ({ params, session }) => {
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return {
      cart: await removeCartLine(adapter, session.tenantId, requireKunnr(session), params.lineId),
    };
  },
);
