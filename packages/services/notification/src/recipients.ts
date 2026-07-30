import { db, runWithTenant } from "@cc/db";
import type { NotificationAudience, Permission, Role } from "@cc/domain";
import { isBackOfficeRole, rolesWithPermission } from "@cc/domain";

/**
 * Who hears about an event.
 *
 * This is the module's security boundary, and it is deliberately the only
 * place in the package that decides it. A notification is a *push* — the
 * recipient did not ask for it, no route guarded it, and there is no URL to
 * return 404 from — so the check every other module performs when a customer
 * pulls data has to be performed here, before the row is written.
 *
 * Two rules, matching the two audiences a template may declare:
 *
 * - **`customer`**: users linked to the sold-to account the event names. That
 *   is the KUNNR boundary orders, deliveries, invoices and tickets already
 *   enforce (ADR-025, ADR-032), applied to a push instead of a read.
 * - **`back_office`**: users holding the template's permission *and* a
 *   back-office role. The role check is redundant against today's registry —
 *   no buyer role holds `support:resolve` or `credit:decide-limit` — and it
 *   is here precisely because that is a property of the current table rather
 *   than a guarantee. A tenant-plane notification quotes another customer's
 *   account number in its title; the day somebody grants a buyer role one of
 *   those permissions, that must fail closed.
 *
 * Both filters are pushed into SQL rather than applied to a loaded list, for
 * ADR-028's reason: a row that was never selected cannot be leaked by the
 * next person who edits the loop.
 */

export interface NotificationRecipientRow {
  id: string;
  email: string;
  roles: Role[];
}

export interface ResolveRecipientsInput {
  tenantId: string;
  audience: NotificationAudience;
  permission: Permission;
  /** The account the event concerns. Required for a `customer` audience. */
  kunnr?: string;
}

export async function resolveRecipients(
  input: ResolveRecipientsInput,
): Promise<NotificationRecipientRow[]> {
  const eligibleRoles = rolesWithPermission(input.permission);
  if (eligibleRoles.length === 0) return [];

  if (input.audience === "customer") {
    // No account, no fan-out. The alternative — treating a missing KUNNR as
    // "everyone with the permission" — is the failure mode ADR-032 describes
    // for a dropped argument, and here it would deliver one customer's order
    // confirmation to every buyer on the tenant.
    if (!input.kunnr) return [];

    return runWithTenant(input.tenantId, () =>
      db.user.findMany({
        where: {
          isActive: true,
          roles: { hasSome: eligibleRoles },
          accountLinks: { some: { sapKunnr: input.kunnr, tenantId: input.tenantId } },
        },
        select: { id: true, email: true, roles: true },
        orderBy: { email: "asc" },
      }),
    );
  }

  const backOffice = eligibleRoles.filter(isBackOfficeRole);
  if (backOffice.length === 0) return [];

  return runWithTenant(input.tenantId, () =>
    db.user.findMany({
      where: { isActive: true, roles: { hasSome: backOffice } },
      select: { id: true, email: true, roles: true },
      orderBy: { email: "asc" },
    }),
  );
}
