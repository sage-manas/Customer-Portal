import { uploadSignedPod } from "@cc/service-delivery";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The signed-POD scan (docs/03 Screen 5.2).
 *
 * Uploaded before the receipt is submitted and answered with a storage key
 * the form carries into the POST next door — the bytes are the slow part, and
 * a customer whose upload fails after SAP has taken the receipt could never
 * attach it, because SAP refuses a second POD.
 *
 * The storage adapter enforces the type/size policy; the browser-side check
 * in `FileUpload` is a courtesy, not the control.
 */
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("delivery:confirm-receipt");
    const { vbeln } = await params;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await uploadSignedPod(
      sap,
      { tenantId: session.tenantId, kunnr: session.kunnr },
      vbeln,
      {
        fileName: file.name,
        contentType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
      },
    );

    return NextResponse.json(result, { status: 201 });
  });
}
