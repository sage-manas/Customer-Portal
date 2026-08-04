import { isPlatformRole, isRole, type Role } from "@cc/domain";
import { createOperator, listOperators } from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleOps, requireOperator } from "@/lib/route";

export const runtime = "nodejs";

/**
 * The role list is validated against the registry's own predicates rather
 * than a `z.enum(["super_admin", "sap_manager"])`: a literal here is a
 * fourth place the platform plane is spelled out (after the permission
 * table, the token parse and `operatorLogin`), and the one most likely to
 * go stale. The service refuses a roleless input anyway — this only turns
 * it into a 400 with a message instead of a 403.
 */
const createSchema = z.object({
  email: z.string().email(),
  roles: z
    .array(z.string())
    .min(1)
    .transform((roles) =>
      roles.filter((role): role is Role => isRole(role) && isPlatformRole(role)),
    )
    .refine((roles) => roles.length > 0, "Pick at least one platform role"),
});

export async function GET() {
  return handleOps(async () => {
    await requireOperator("platform:operators-manage");
    return NextResponse.json({ operators: await listOperators() });
  });
}

export async function POST(request: Request) {
  return handleOps(async () => {
    await requireOperator("platform:operators-manage");

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }

    return NextResponse.json(await createOperator(parsed.data), { status: 201 });
  });
}
