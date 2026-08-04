import { getTenantSapConfig, updateTenantSapConfig } from "@cc/service-platform";
import { resetSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

const updateSchema = z.object({
  driver: z.enum(["mock", "ecc", "s4"]),
  /** Keys are validated against the field registry inside the service —
   * duplicating that list here is exactly what the registry exists to
   * prevent (rule 3). */
  params: z.record(z.string()).default({}),
  clearSecrets: z.array(z.string()).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    await requireOperator("platform:sap-config");
    const { id } = await params;
    return NextResponse.json(await getTenantSapConfig(id));
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    const operator = await requireOperator("platform:sap-config");
    const { id } = await params;

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const result = await updateTenantSapConfig({
      tenantId: id,
      driver: parsed.data.driver,
      params: parsed.data.params,
      clearSecrets: parsed.data.clearSecrets,
      operatorId: operator.operatorId,
      operatorEmail: operator.email,
    });

    // The adapter factory caches one instance per tenant (it owns
    // connection state and the circuit breaker), so a saved configuration
    // that nobody invalidated would keep talking to the old system until
    // the process restarted — the single most confusing possible outcome
    // of this screen. Dropping the cache is `@cc/service-sap`'s job because
    // resolution is; this handler sequences the two (ADR-011).
    await resetSapAdapterForTenant(id);

    return NextResponse.json(result);
  });
}
