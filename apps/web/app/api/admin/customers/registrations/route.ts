import { startBackOfficeRegistration } from "@cc/service-onboarding";
import { NextResponse } from "next/server";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * Starts a registration the tenant fills in on the customer's behalf
 * (ADR-056) — the back-office half of `POST /api/onboarding`.
 *
 * The response deliberately carries no draft token. The applicant's flow
 * needs one because they have no session (ADR-009); here the session *is*
 * the credential, and handing out a bearer token for a back-office row would
 * only create a second way to reach it.
 */
export const runtime = "nodejs";

export async function POST() {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    return NextResponse.json(await startBackOfficeRegistration(session.tenantId, session.userId), {
      status: 201,
    });
  });
}
