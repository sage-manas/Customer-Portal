import { salesOrderWriteSchema } from "@cc/domain";
import { clearCart } from "@cc/service-catalogue";
import { assertCustomerCanOrder } from "@cc/service-customer";
import {
  createOrder,
  listOrders,
  markDraftSubmitted,
  type OrderStatusFilter,
} from "@cc/service-order";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's sales orders (docs/03 Module 4).
 *
 * `order:view` lists, `order:create` submits — the two are separate
 * permissions because a buyer may be trusted to watch an account's orders
 * without being trusted to place one (docs/05 §4.3).
 *
 * POST sequences three things that belong to three different owners: SAP
 * creates the order, the draft row records what it became, and the cart is
 * emptied. Per ADR-011 that sequencing lives here rather than inside any one
 * service — and the order is deliberate. SAP goes first, because a cart
 * cleared for an order that never reached SAP is lost work.
 */
export const runtime = "nodejs";

const FILTERS: readonly OrderStatusFilter[] = ["all", "open", "creditHold", "completed"];

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("order:view");

    const requested = new URL(request.url).searchParams.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "all";

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await listOrders(sap, session.kunnr, { filter }));
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("order:create");

    const body = (await request.json().catch(() => null)) as
      (Record<string, unknown> & { draftId?: string; fromCart?: boolean }) | null;

    const parsed = salesOrderWriteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before this order can go through.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    // A customer whose portal access the tenant switched off may not place
    // new orders (ADR-057). Checked here rather than inside
    // `@cc/service-order` because a service may not import another, and the
    // API is the enforcement point either way (CLAUDE.md rule 5).
    if (session.kunnr) await assertCustomerCanOrder(session.tenantId, session.kunnr);

    const sap = await getSapAdapterForTenant(session.tenantId);
    const order = await createOrder(sap, session.kunnr, parsed.data);

    // Everything past this point is bookkeeping about an order that already
    // exists in SAP, so none of it may turn a created order into an error
    // response — the customer would re-submit an order they already placed.
    if (typeof body?.draftId === "string") {
      await markDraftSubmitted(session.tenantId, session.kunnr, body.draftId, order).catch(
        () => undefined,
      );
    }
    if (body?.fromCart === true) {
      await clearCart(session.tenantId, session.kunnr, sap).catch(() => undefined);
    }

    return NextResponse.json({ order }, { status: 201 });
  });
}
