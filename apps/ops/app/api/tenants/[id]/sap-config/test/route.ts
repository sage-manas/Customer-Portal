import { testSapConnection } from "@cc/service-platform";
import { getSapAdapterForTenant, resetSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

/**
 * "Test connection" (doc 09 §3.3) — the handler ADR-011 describes: two
 * services, sequenced by the route rather than by one importing the other.
 * `@cc/service-sap` knows how to build a tenant's adapter from its stored
 * configuration; `@cc/service-platform` knows what a connection test means
 * and records it in the trail. Neither needs to learn the other's job.
 *
 * The cache is dropped first so the test probes what is *stored*, not what
 * a resolver happened to build before the operator changed anything.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    const operator = await requireOperator("platform:sap-config");
    const { id } = await params;

    await resetSapAdapterForTenant(id);
    const adapter = await getSapAdapterForTenant(id);

    return NextResponse.json(await testSapConnection(id, adapter, operator));
  });
}
