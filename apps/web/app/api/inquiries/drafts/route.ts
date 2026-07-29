import { inquiryDraftSchema } from "@cc/domain";
import { listDrafts, saveDraft } from "@cc/service-inquiry";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Inquiry drafts — "Draft/Submit" on docs/05 §7.3.
 *
 * A draft is portal-owned and has no SAP counterpart, so no adapter is
 * resolved here. It is validated against the *draft* schema, which requires
 * nothing: a draft that must be complete before it can be saved is not a
 * draft. The mandatory fields bite at submission (POST /api/inquiries).
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:view");
    return NextResponse.json({ drafts: await listDrafts(session.tenantId, session.kunnr) });
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:create");

    const parsed = inquiryDraftSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before this draft can be saved.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const draft = await saveDraft(session.tenantId, session.kunnr, parsed.data);
    return NextResponse.json({ draft }, { status: 201 });
  });
}
