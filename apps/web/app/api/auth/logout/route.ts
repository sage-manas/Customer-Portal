import { NextResponse } from "next/server";

import { clearSessionCookies } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
