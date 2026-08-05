import {
  getTenant,
  getTenantBilling,
  getTenantHealth,
  getTenantUsage,
  updateTenant,
} from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  /** An empty string clears it back to slug-based host resolution, which is
   * why this is not `.min(1)`: "no custom domain" is a legitimate value. */
  customDomain: z.string().optional(),
  disabledModules: z.array(z.string()).optional(),
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
});

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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    await requireOperator("platform:tenant-crud");
    const { id } = await params;

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    return NextResponse.json({ tenant: await updateTenant({ tenantId: id, ...parsed.data }) });
  });
}
