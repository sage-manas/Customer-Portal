import { getCustomerAccount, updateCustomerAccount } from "@cc/service-customer";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * One customer: the SAP master composed with the portal's access row, and
 * the edit that writes the master back through XD02.
 *
 * The KUNNR is checked against the tenant's own account rows before SAP is
 * touched, and a miss is a 404 — a customer of another tenant must not be
 * distinguishable from one that does not exist (CLAUDE.md rule 5).
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ kunnr: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { kunnr } = await params;

    const sap = await getSapAdapterForTenant(session.tenantId);
    return NextResponse.json(await getCustomerAccount(session.tenantId, kunnr, sap));
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ kunnr: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:edit");
    const { kunnr } = await params;

    const body: unknown = await request.json().catch(() => null);
    const sap = await getSapAdapterForTenant(session.tenantId);

    // Validation is the service's, against the registry-derived schema —
    // this handler parses and maps, nothing more (ADR-002).
    const customer = await updateCustomerAccount(
      session.tenantId,
      kunnr,
      body,
      sap,
      session.userId,
    );

    return NextResponse.json({ customer });
  });
}
