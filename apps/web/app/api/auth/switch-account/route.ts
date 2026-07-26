import { AuthError, requireSession, switchAccount } from "@cc/service-identity";
import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getSession, setSessionCookies } from "@/lib/session";

/**
 * Switches the active sold-to account (docs/05 §4.2). The service re-checks
 * the link against the database — a KUNNR posted here is a request, not a
 * fact.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ kunnr: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const session = requireSession(await getSession());
    const result = await switchAccount(session, parsed.data.kunnr, env.AUTH_SECRET);
    await setSessionCookies(result.tokens);
    return NextResponse.json({ kunnr: result.session.kunnr });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
