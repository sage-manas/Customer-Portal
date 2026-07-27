import { provisionPortalAccess } from "@cc/service-identity";
import { approveApplication } from "@cc/service-onboarding";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * "Approve & Create in SAP" (docs/05 §7.1).
 *
 * The handler orchestrates two services in a deliberate order: onboarding
 * creates the customer in SAP, and only then does identity issue portal
 * credentials — nobody gets a login for a customer SAP hasn't accepted. A
 * service can't call another service (CLAUDE.md rule 1), so this sequencing
 * lives here, in the thin adapter that may depend on both
 * (docs/DECISIONS.md ADR-011).
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  salesOrg: z.string().min(1, "Assign a sales organisation."),
  distributionChannel: z.string().min(1, "Assign a distribution channel."),
  creditApprovalStatus: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("onboarding:approve");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before you can approve.",
          issues: parsed.error.issues.map((issue) => ({
            field: String(issue.path[0] ?? ""),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await approveApplication(
      session.tenantId,
      id,
      { ...parsed.data, actorUserId: session.userId },
      sap,
    );

    const access = await provisionPortalAccess({
      tenantId: session.tenantId,
      email: result.contactEmail,
      kunnr: result.kunnr,
    });

    return NextResponse.json({
      application: result.application,
      kunnr: result.kunnr,
      // Shown once on the approval screen so the reviewer can pass it on;
      // it is not stored anywhere in plaintext, and first sign-in forces a
      // change (docs/05 §8).
      credentials: access.created
        ? { email: access.email, temporaryPassword: access.temporaryPassword }
        : { email: access.email, temporaryPassword: null },
    });
  });
}
