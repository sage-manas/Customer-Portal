import { paymentInitiateSchema } from "@cc/domain";
import { getPaymentGatewayForTenant, initiatePayment, listPayments } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's payments (docs/03 Screen 7.2).
 *
 * `payment:view` lists, `payment:pay` initiates — separate permissions,
 * because seeing what the account owes and being trusted to move money are
 * different things (docs/05 §4.3).
 *
 * POST does *not* take money. It records the intent and returns a checkout
 * URL; only the gateway's signed webhook advances the payment. That is what
 * makes a closed browser tab survivable.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("payment:view");
    return NextResponse.json({ payments: await listPayments(session.tenantId, session.kunnr) });
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("payment:pay");

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = paymentInitiateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before this payment can go through.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    // Both adapters are resolved here and passed in: the payment service owns
    // the gateway (it is its own module's external system) but may not import
    // @cc/service-sap, because a service may not import another service
    // (CLAUDE.md rule 1, ADR-011).
    const [sap, gateway] = await Promise.all([
      getSapAdapterForTenant(session.tenantId),
      getPaymentGatewayForTenant(session.tenantId),
    ]);

    const initiated = await initiatePayment(session.tenantId, session.kunnr, parsed.data, {
      sap,
      gateway,
      userId: session.userId,
    });

    return NextResponse.json(initiated, { status: 201 });
  });
}
