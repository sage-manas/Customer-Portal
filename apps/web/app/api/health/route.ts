import { getSystemHealth } from "@cc/service-health";
import { NextResponse } from "next/server";

/**
 * Readiness for the process (docs/07 B3). Public in `middleware.ts` and
 * never rate-limited — the caller is an orchestrator or a load balancer
 * polling this process, not a tenant, and it needs an answer even while a
 * tenant (or an attacker pretending to be one) is being throttled.
 *
 * No session, no tenant: "is Postgres reachable" has one answer for the
 * whole process, unlike every other route in the app.
 */
export const runtime = "nodejs";

export async function GET() {
  const health = await getSystemHealth();
  return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 });
}
