import { NextResponse } from "next/server";

import { clearOperatorSessionCookies } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await clearOperatorSessionCookies();
  return NextResponse.json({ ok: true });
}
