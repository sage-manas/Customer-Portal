import { ONBOARDING_DOCUMENT_KINDS, type OnboardingDocumentKind } from "@cc/domain";
import { removeBackOfficeDocument, uploadBackOfficeDocument } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Step-4 uploads for a back-office registration. Bytes go to the same
 * storage adapter, which enforces the type/size policy server-side.
 */
export const runtime = "nodejs";

function parseKind(kind: string): OnboardingDocumentKind | null {
  return (ONBOARDING_DOCUMENT_KINDS as readonly string[]).includes(kind)
    ? (kind as OnboardingDocumentKind)
    : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id, kind } = await params;

    const documentKind = parseKind(kind);
    if (!documentKind) {
      return NextResponse.json({ error: "We couldn't find that document slot." }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    const application = await uploadBackOfficeDocument(session.tenantId, id, {
      kind: documentKind,
      fileName: file.name,
      contentType: file.type,
      body: new Uint8Array(await file.arrayBuffer()),
    });

    return NextResponse.json({ application });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id, kind } = await params;

    const documentKind = parseKind(kind);
    if (!documentKind) {
      return NextResponse.json({ error: "We couldn't find that document slot." }, { status: 404 });
    }

    const application = await removeBackOfficeDocument(session.tenantId, id, documentKind);
    return NextResponse.json({ application });
  });
}
