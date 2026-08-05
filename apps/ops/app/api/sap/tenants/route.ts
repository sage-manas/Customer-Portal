import { listTenants } from "@cc/service-platform";
import { NextResponse } from "next/server";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

/**
 * The tenant picker for the SAP screens — `platform:sap-config`, not
 * `platform:tenant-crud`.
 *
 * Its own route rather than a widened `/api/tenants` (which the registry
 * already flagged as Phase 4's job): the CRUD index is where a tenant gets
 * created and deactivated, and a SAP manager holds neither capability. What
 * they need is the identity of the tenants whose connections they manage,
 * which is what this returns and nothing more.
 */
export async function GET() {
  return handleOps(async () => {
    await requireOperator("platform:sap-config");
    const tenants = await listTenants();
    return NextResponse.json({
      tenants: tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        sapDriver: tenant.sapDriver,
        isActive: tenant.isActive,
      })),
    });
  });
}
