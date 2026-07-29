import { inquiryDraftSchema } from "@cc/domain";
import { deleteDraft, saveDraft } from "@cc/service-inquiry";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * One inquiry draft. The id is not trusted to belong to the caller's sold-to
 * account: `saveDraft`/`deleteDraft` scope every query by KUNNR inside the
 * tenant context, so another account's draft is not found rather than
 * forbidden (CLAUDE.md rule 5). A draft that has already become an inquiry is
 * equally not found — it is a SAP document by then.
 */
export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:create");
    const { id } = await params;

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

    const draft = await saveDraft(session.tenantId, session.kunnr, parsed.data, id);
    return NextResponse.json({ draft });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("inquiry:create");
    const { id } = await params;

    await deleteDraft(session.tenantId, session.kunnr, id);
    return new NextResponse(null, { status: 204 });
  });
}
