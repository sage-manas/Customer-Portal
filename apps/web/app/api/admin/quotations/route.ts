import { issueQuotation, issueQuotationSchema, listInquiryQueue } from "@cc/service-inquiry";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * The quotation workbench (docs/05 §7.3, §8).
 *
 * Both verbs need `quotation:issue`, and that permission is the whole
 * boundary here: unlike every customer-plane route in the portal, nothing on
 * this one is scoped to a KUNNR — a sales user legitimately sees every
 * account's inquiries. That is precisely why it lives under `/api/admin`,
 * calls the back-office service file, and reads the queue through the
 * adapter's own tenant-wide method rather than the customer's.
 */
export const runtime = "nodejs";

export async function GET() {
  return handleAdmin(async () => {
    const session = await requireBackOffice("quotation:issue");

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await listInquiryQueue(sap));
  });
}

export async function POST(request: Request) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("quotation:issue");

    const parsed = issueQuotationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before this quotation can be issued.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const quotation = await issueQuotation(
      sap,
      { tenantId: session.tenantId, userId: session.userId },
      parsed.data,
    );

    return NextResponse.json({ quotation }, { status: 201 });
  });
}
