import { salesOrderDraftSchema } from "@cc/domain";
import { listDrafts, saveDraft } from "@cc/service-order";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Order drafts — "Save Draft" on docs/03 Screen 4.1.
 *
 * A draft is portal-owned and has no SAP counterpart, so no adapter is
 * resolved here. It is validated against the *draft* schema, which requires
 * nothing: a draft that must be complete before it can be saved is not a
 * draft. The mandatory fields bite at submission (POST /api/orders).
 *
 * Saving needs `order:create` — a draft is the first step of placing an
 * order, and it is visible to everyone on the sold-to account.
 */
export const runtime = "nodejs";

export async function GET() {
  return handlePortal(async () => {
    const session = await requirePortal("order:view");
    return NextResponse.json({ drafts: await listDrafts(session.tenantId, session.kunnr) });
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("order:create");

    const parsed = salesOrderDraftSchema.safeParse(await request.json().catch(() => null));
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
