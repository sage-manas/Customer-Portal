import { inquiryWriteSchema } from "@cc/domain";
import {
  createInquiry,
  listInquiries,
  markDraftSubmitted,
  type InquiryFilter,
} from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's inquiries (docs/03 Module 3, docs/05 §7.3).
 *
 * `inquiry:view` lists, `inquiry:create` raises. One role holds both after
 * the collapse (ADR-061); they stay separate because reading what the
 * account has asked for and committing it to a new requirement are different
 * acts, and the registry is where that distinction survives (docs/05 §4.3).
 *
 * POST sequences two owners: SAP creates the inquiry (VA11), then the portal
 * records which draft it came from. The order is deliberate and the
 * bookkeeping is best-effort — an inquiry that exists in SAP must never come
 * back as an error, or the customer raises it twice.
 */
export const runtime = "nodejs";

const FILTERS: readonly InquiryFilter[] = ["all", "awaiting", "quoted"];

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:view");

    const requested = new URL(request.url).searchParams.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "all";

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(
      await listInquiries(
        sap,
        { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
        { filter },
      ),
    );
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:create");

    const body = (await request.json().catch(() => null)) as
      (Record<string, unknown> & { draftId?: string }) | null;

    const parsed = inquiryWriteSchema.safeParse(body);
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

    const sap = await getSapAdapterForTenant(session.tenantId);
    const context = {
      tenantId: session.tenantId,
      kunnr: session.kunnr,
      userId: session.userId,
    };

    const inquiry = await createInquiry(sap, context, parsed.data);

    if (typeof body?.draftId === "string") {
      await markDraftSubmitted(session.tenantId, session.kunnr, body.draftId, inquiry.vbeln).catch(
        () => undefined,
      );
    }

    return NextResponse.json({ inquiry }, { status: 201 });
  });
}
