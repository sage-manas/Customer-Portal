import { AuthError, login } from "@cc/service-identity";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { setSessionCookies } from "@/lib/session";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Credentials login. A thin adapter over `@cc/service-identity` (ADR-002):
 * parse, delegate, set cookies, map the domain error to a status code —
 * no auth logic lives in this file.
 */

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const tenant = await resolveRequestTenant();
  if (!tenant) {
    return NextResponse.json(
      { error: "We couldn't find a portal at this address." },
      { status: 404 },
    );
  }

  try {
    const result = await login({ ...parsed.data, tenantSlug: tenant.slug }, env.AUTH_SECRET);
    await setSessionCookies(result.tokens);

    return NextResponse.json({
      email: result.session.email,
      roles: result.session.roles,
      kunnr: result.session.kunnr,
      mustChangePassword: result.mustChangePassword,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
