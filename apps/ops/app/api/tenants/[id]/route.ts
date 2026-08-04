import { getTenant, getTenantBilling, getTenantHealth, getTenantUsage } from "@cc/service-platform";
import { NextResponse } from "next/server";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    await requireOperator("platform:tenant-crud");
    const { id } = await params;

    const tenant = await getTenant(id);
    if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const [health, usage, billing] = await Promise.all([
      getTenantHealth(id),
      getTenantUsage(id),
      getTenantBilling(id),
    ]);

    return NextResponse.json({ tenant, health, usage, billing });
  });
}
