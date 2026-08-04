import { registerCustomerAccount } from "@cc/service-customer";
import { findTenantBySlug, provisionPortalAccess } from "@cc/service-identity";
import { getNotificationSender, portalUrl } from "@cc/service-notification";
import { registerCustomer } from "@cc/service-onboarding";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";
import { z } from "zod";

import { handleAdmin, requireBackOffice } from "@/lib/admin-route";

/**
 * "Register customer" — the last click of `/admin/customers/new` (ADR-056).
 *
 * Four owners, sequenced here because a service may not call another
 * (ADR-011), and the order is the point:
 *
 *  1. onboarding submits *and* approves — same validation as a public
 *     application, no review gate, because the initiator is the approver.
 *     SAP creates the customer master.
 *  2. the customer service records the portal's own access row, so the new
 *     account appears in the directory and can be deactivated later.
 *  3. identity issues credentials — nobody gets a login for a customer SAP
 *     has not accepted, which is why this cannot come first.
 *  4. the credentials are emailed to the customer.
 *
 * Steps 2–4 are bookkeeping about a customer that already exists in SAP, so
 * none of them may turn a created customer into an error response: the
 * admin would re-submit a registration SAP has already accepted and hit the
 * duplicate-GSTIN guard. They record their failure in the response instead.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  salesOrg: z.string().min(1, "Assign a sales organisation."),
  distributionChannel: z.string().min(1, "Assign a distribution channel."),
  creditApprovalStatus: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAdmin(async () => {
    const session = await requireBackOffice("customer:register");
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before this customer can be created.",
          issues: parsed.error.issues.map((issue) => ({
            field: String(issue.path[0] ?? ""),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const sap = await getSapAdapterForTenant(session.tenantId);
    const result = await registerCustomer(
      session.tenantId,
      id,
      { ...parsed.data, actorUserId: session.userId },
      sap,
    );

    await registerCustomerAccount(session.tenantId, {
      kunnr: result.kunnr,
      registeredByUserId: session.userId,
      onboardingApplicationId: id,
    }).catch(() => undefined);

    const access = await provisionPortalAccess({
      tenantId: session.tenantId,
      email: result.contactEmail,
      kunnr: result.kunnr,
    });

    const emailed = access.created
      ? await mailCredentials({
          tenantId: session.tenantId,
          tenantSlug: session.tenantSlug,
          userId: access.userId,
          email: access.email,
          temporaryPassword: access.temporaryPassword,
          legalEntityName: result.legalEntityName,
        })
      : false;

    return NextResponse.json({
      application: result.application,
      kunnr: result.kunnr,
      // Shown once on screen as well as mailed: the admin is standing in
      // front of the customer often enough that "we sent an email" is not
      // always the fastest way to get them signed in, and this password is
      // stored nowhere in plaintext (first sign-in forces a change).
      credentials: access.created
        ? { email: access.email, temporaryPassword: access.temporaryPassword }
        : { email: access.email, temporaryPassword: null },
      emailed,
    });
  });
}

/**
 * Sends the credentials directly rather than through the outbox and the
 * notification registry.
 *
 * That is deliberate and is the one exception in the codebase: a template in
 * `NOTIFICATION_TEMPLATES` renders from an event payload that has been
 * written to `outbox_events` and then to a bell row, and a temporary
 * password must not be written to either (ADR-056). Nothing is persisted
 * here — the mail is composed and handed to the sender, which never throws
 * for a delivery failure (it returns `delivered: false`), so a mail outage
 * costs the admin the password on screen and nothing else.
 */
async function mailCredentials(input: {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  email: string;
  temporaryPassword: string;
  legalEntityName: string;
}): Promise<boolean> {
  const tenant = await findTenantBySlug(input.tenantSlug);
  const url = portalUrl(input.tenantSlug, "/login");
  const tenantName = tenant?.name ?? "your supplier";

  const result = await getNotificationSender()
    .send({
      channel: "email",
      tenantId: input.tenantId,
      tenantName,
      recipient: { userId: input.userId, email: input.email, name: input.legalEntityName },
      subject: `Your ${tenantName} customer portal account is ready`,
      body: [
        `${tenantName} has registered ${input.legalEntityName} on their customer portal.`,
        "",
        `Sign in with ${input.email} and this temporary password: ${input.temporaryPassword}`,
        "",
        "You'll be asked to choose your own password the first time you sign in.",
      ].join("\n"),
      url,
      severity: "info",
      // Stable for this registration, so a retried request cannot mail two
      // different passwords for one account.
      idempotencyKey: `customer-credentials:${input.tenantId}:${input.userId}`,
    })
    .catch(() => ({ delivered: false }));

  return result.delivered;
}
