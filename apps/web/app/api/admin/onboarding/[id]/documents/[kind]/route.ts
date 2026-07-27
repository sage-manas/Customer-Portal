import { ONBOARDING_DOCUMENT_KINDS, type OnboardingDocumentKind } from "@cc/domain";
import { readDocument } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Streams an applicant's uploaded document to a reviewer.
 *
 * Storage keys are never handed to the browser: the file comes back through
 * this handler, which re-checks the session and the tenant every time. A
 * signed direct-to-bucket URL would move that check to the moment the link
 * was minted rather than the moment it is used.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("onboarding:review");
    const { id, kind } = await params;

    if (!(ONBOARDING_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: "We couldn't find that document." }, { status: 404 });
    }

    const file = await readDocument(session.tenantId, id, kind as OnboardingDocumentKind);

    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        // `inline` so the reviewer can read it in the browser; the filename
        // is quoted because applicants upload files with spaces in them.
        "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
