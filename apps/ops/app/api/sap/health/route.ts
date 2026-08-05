import { getTenantHealth, listTenants } from "@cc/service-platform";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

/**
 * Fleet-wide SAP health (doc 09 §3.3). The B5 read-model per tenant, plus a
 * live probe the read-model deliberately does not perform — see the health
 * page for why the two are reported separately rather than merged into one
 * green tick.
 *
 * The adapter is resolved through `@cc/service-sap` here in the handler:
 * `@cc/service-platform` may not import another service (rule 1), so the app
 * is what sequences them (ADR-011).
 */
export async function GET() {
  return handleOps(async () => {
    await requireOperator("platform:sap-health");

    const tenants = await listTenants();
    const rows = await Promise.all(
      tenants.map(async (tenant) => {
        const health = await getTenantHealth(tenant.id);
        const probe = await getSapAdapterForTenant(tenant.id)
          .then((adapter) => adapter.health())
          .catch((error: unknown) => ({
            reachable: false,
            driver: tenant.sapDriver,
            circuit: "unknown" as const,
            checkedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Probe failed",
          }));

        return {
          tenantId: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          health,
          probe,
        };
      }),
    );

    return NextResponse.json({ tenants: rows });
  });
}
