import { ONBOARDING_DOCUMENT_KINDS, type OnboardingDocumentKind } from "@cc/domain";
import { removeDocument, uploadDocument } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { RouteError, handle, resolveDraftContext } from "@/lib/onboarding-route";

/**
 * Step-4 uploads. Bytes go to the storage adapter, which enforces the
 * type/size policy server-side — the client-side check in `FileUpload` is a
 * courtesy, not the control.
 */
export const runtime = "nodejs";

function parseKind(kind: string): OnboardingDocumentKind {
  if (!(ONBOARDING_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    throw new RouteError(404, "We couldn't find that document slot.");
  }
  return kind as OnboardingDocumentKind;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id, kind } = await params;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new RouteError(400, "No file was uploaded.");

    const application = await uploadDocument(
      tenantId,
      { applicationId: id, draftToken },
      {
        kind: parseKind(kind),
        fileName: file.name,
        contentType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
      },
    );

    return NextResponse.json({ application });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return handle(async () => {
    const { tenantId, draftToken } = await resolveDraftContext(request);
    const { id, kind } = await params;

    const application = await removeDocument(
      tenantId,
      { applicationId: id, draftToken },
      parseKind(kind),
    );
    return NextResponse.json({ application });
  });
}
