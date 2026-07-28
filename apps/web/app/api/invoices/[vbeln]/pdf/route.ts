import { getInvoicePdfUrl } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * "Download Invoice PDF" (docs/03 Screen 6.1).
 *
 * The permission and the sold-to account are re-checked here rather than
 * trusted from the screen that rendered the link — the same reasoning as the
 * onboarding document stream (ADR-012): a URL is shareable, and this is the
 * call that actually hands over a statutory document. A signed direct link
 * would move the check to the moment the link was minted instead of the
 * moment it is used, which is the wrong trade for a tax invoice.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ vbeln: string }> }) {
  return handlePortal(async () => {
    const session = await requirePortal("invoice:view");
    const { vbeln } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    const url = await getInvoicePdfUrl(sap, session.kunnr, vbeln);

    // The mock driver returns a path; a real driver returns a signed URL or
    // streams bytes. Either way the client only ever sees it post-check.
    return NextResponse.json({ url });
  });
}
