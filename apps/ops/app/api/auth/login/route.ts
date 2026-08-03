import { operatorLogin, isPlatformError } from "@cc/service-platform";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { setOperatorSessionCookies } from "@/lib/session";

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

  try {
    const result = await operatorLogin(
      parsed.data.email,
      parsed.data.password,
      env.OPS_AUTH_SECRET,
    );
    await setOperatorSessionCookies(result.tokens);

    return NextResponse.json({
      email: result.claims.email,
      mustChangePassword: result.mustChangePassword,
    });
  } catch (error) {
    if (isPlatformError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
