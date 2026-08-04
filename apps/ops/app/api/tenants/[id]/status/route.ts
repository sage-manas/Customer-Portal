import { setTenantActive } from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

const bodySchema = z.object({ isActive: z.boolean() });

/**
 * Soft deactivate / reactivate (ADR-054).
 *
 * One route carrying the target state rather than two verbs, because the
 * two directions are the same decision and pairing them makes it obvious in
 * the registry that deactivation is reversible. There is no DELETE here or
 * anywhere else in the console: a tenant's orders, deliveries and invoices
 * are the portal's side of documents SAP has already posted, and no
 * confirmation dialog makes erasing them recoverable.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleOps(async () => {
    await requireOperator("platform:tenant-crud");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { isActive: boolean }" }, { status: 400 });
    }

    return NextResponse.json(await setTenantActive(id, parsed.data.isActive));
  });
}
