import { createTenant, listTenants } from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  name: z.string().min(2),
  customDomain: z.string().optional(),
  sapDriver: z.enum(["mock", "ecc", "s4"]).optional(),
  gstnDriver: z.enum(["mock", "api"]).optional(),
  paymentGateway: z.enum(["mock", "razorpay"]).optional(),
  adminEmail: z.string().email(),
});

export async function GET() {
  return handleOps(async () => {
    await requireOperator();
    return NextResponse.json({ tenants: await listTenants() });
  });
}

export async function POST(request: Request) {
  return handleOps(async () => {
    await requireOperator();

    const parsed = createTenantSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    const result = await createTenant(parsed.data);
    return NextResponse.json(result, { status: 201 });
  });
}
