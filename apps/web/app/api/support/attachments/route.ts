import { uploadTicketAttachment } from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Ticket attachments (docs/03 Screen 8.1 "Attachment (GOS)").
 *
 * Uploaded *before* the ticket or comment is submitted, and answered with a
 * storage key the form then carries into the write — the same two-step shape
 * as the signed-POD scan, and for the same reason: the bytes are the slow,
 * failure-prone part, and a customer whose upload times out after the ticket
 * was raised would have a ticket describing a file that isn't there.
 *
 * This route is deliberately not under `/[id]`: the first attachments are
 * chosen before a ticket exists, so keys are namespaced by a client-supplied
 * draft reference. That reference only affects the storage path, never
 * ownership — the key is tenant-prefixed by construction, and the write that
 * follows is what actually binds a file to a ticket the customer owns.
 */
export const runtime = "nodejs";

/** Keeps a client-supplied path segment from escaping its tenant prefix. */
function safeRef(value: string | null): string {
  const cleaned = (value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "draft";
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("support:create");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }

    const result = await uploadTicketAttachment(
      { tenantId: session.tenantId },
      safeRef(form.get("ref") as string | null),
      {
        fileName: file.name,
        contentType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
      },
    );

    return NextResponse.json(result, { status: 201 });
  });
}
