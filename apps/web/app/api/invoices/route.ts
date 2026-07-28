import { listCreditDebitNotes, listInvoices, type InvoiceStatusFilter } from "@cc/service-invoice";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * The customer's billing documents (docs/03 Module 6).
 *
 * Read-only: the portal never creates a billing document — VF01 is SAP's,
 * triggered by delivery or order, and nothing here writes. `?kind=notes`
 * serves the Credit/Debit Notes tab, which is a separate view rather than a
 * filter because a credit note is not a bill (ADR-020).
 */
export const runtime = "nodejs";

const FILTERS: readonly InvoiceStatusFilter[] = ["all", "open", "overdue", "paid"];

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("invoice:view");

    const params = new URL(request.url).searchParams;
    const requested = params.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "all";

    const sap = await getSapAdapterForTenant(session.tenantId);

    if (params.get("kind") === "notes") {
      return NextResponse.json(await listCreditDebitNotes(sap, session.kunnr));
    }
    return NextResponse.json(await listInvoices(sap, session.kunnr, { filter }));
  });
}
