import { clearCart, getCart } from "@cc/service-catalogue";
import { getSapAdapterForTenant } from "@cc/service-sap";

import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * The cart is repriced on every read, so this is never a cheap lookup — it is
 * a SAP round-trip per line, deliberately (ADR-014).
 */
export const GET = route(
  { guard: { kind: "permission", permission: "catalogue:view" } },
  async ({ session }) => {
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return { cart: await getCart(session.tenantId, requireKunnr(session), adapter) };
  },
);

export const DELETE = route(
  { guard: { kind: "permission", permission: "cart:manage" } },
  async ({ session }) => {
    const adapter = await getSapAdapterForTenant(session.tenantId);
    return { cart: await clearCart(adapter, session.tenantId, requireKunnr(session)) };
  },
);
