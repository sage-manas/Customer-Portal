import { creditIncreaseRequestSchema } from "@cc/domain";
import { listCreditRequests, requestCreditIncrease } from "@cc/service-loyalty";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Credit-limit increase requests (docs/03 Screen 9.1, docs/05 §7.9).
 *
 * `account:view` lists; `credit:request` raises. Two permissions because the
 * ask commits the account to a commercial conversation and quotes a
 * justification in the customer's name — a customer's own call rather than an
 * everyday transaction (docs/05 §4.3).
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("account:view");

    return NextResponse.json(
      await listCreditRequests({
        tenantId: session.tenantId,
        kunnr: session.kunnr,
        userId: session.userId,
      }),
    );
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("credit:request");

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = creditIncreaseRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before we can send this.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    // The adapter is resolved here and passed in: `@cc/service-loyalty` may
    // not import `@cc/service-sap` (ADR-011), and the current limit has to
    // come from KNKK rather than from the form.
    const sap = await getSapAdapterForTenant(session.tenantId);

    const created = await requestCreditIncrease(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      parsed.data,
    );

    return NextResponse.json(created, { status: 201 });
  });
}
