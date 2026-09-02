import { uploadTicketAttachment } from "@cc/service-support";

import { ValidationError } from "@/server/errors";
import { route } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** Matches what the migrated upload control sends, and what storage can hold. */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);

/**
 * Accepts a ticket attachment.
 *
 * Scoped to `user`, not `kunnr`: the file is uploaded before the ticket it
 * belongs to exists, so there is no document to bound it by yet. The storage
 * key it returns is tenant-prefixed, and the ticket write is what ties the
 * file to an account.
 */
export const POST = route(
  { guard: { kind: "permission", permission: "support:create" } },
  async ({ request, session }) => {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) throw new ValidationError("Attach a file.");
    if (file.size > MAX_BYTES) {
      throw new ValidationError("That file is larger than the 10 MB limit.");
    }
    // Type is checked against an allow-list rather than a deny-list: a new
    // dangerous type must not become uploadable by default.
    if (file.type && !ALLOWED.has(file.type)) {
      throw new ValidationError("That file type isn't accepted.");
    }

    const uploaded = await uploadTicketAttachment({
      tenantId: session.tenantId,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      body: new Uint8Array(await file.arrayBuffer()),
    });

    return Response.json(uploaded, { status: 201 });
  },
);
