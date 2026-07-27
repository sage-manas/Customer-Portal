import { randomBytes } from "node:crypto";

import { db, runWithTenant } from "@cc/db";
import type { Role } from "@cc/domain";

import { hashPassword } from "./password";

/**
 * Issues portal access for a newly approved customer (docs/03 Module 1:
 * "Approved → BAPI create + customer code sync-back + credentials issued").
 *
 * This lives in the identity service, not in onboarding: the password-hash
 * format is owned here (the same reasoning as ADR-008 for the dev seed),
 * and a service may not import another service. The onboarding route
 * handler calls `approveApplication` and then this, in that order —
 * credentials are only ever issued for a customer SAP has actually created.
 */

export interface ProvisionPortalAccessInput {
  tenantId: string;
  /** The applicant's contact email — their login id (ADR6-SMTP_ADDR). */
  email: string;
  /** The KUNNR SAP assigned; the account this login may act for. */
  kunnr: string;
  /**
   * Defaults to `buyer_admin`: the first user of a new customer has to be
   * able to invite their colleagues, or every new account needs a support
   * ticket to become usable.
   */
  roles?: Role[];
}

export interface ProvisionPortalAccessResult {
  userId: string;
  email: string;
  /**
   * Shown once to the reviewer and sent to the applicant. It is not stored:
   * only its scrypt hash is, and `mustChangePassword` forces a change at
   * first sign-in (docs/05 §8).
   */
  temporaryPassword: string;
  /** False when the email already had a portal user, which was linked instead. */
  created: boolean;
}

/** 24 random base64url characters — well above the 12-char floor `setPassword` enforces. */
function temporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

export async function provisionPortalAccess(
  input: ProvisionPortalAccessInput,
): Promise<ProvisionPortalAccessResult> {
  const email = input.email.trim().toLowerCase();
  const roles = input.roles ?? (["buyer_admin"] as Role[]);
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return runWithTenant(input.tenantId, async () => {
    const existing = await db.user.findFirst({ where: { email } });

    const user = existing
      ? // An existing login keeps its password and roles — approving a second
        // sold-to account for someone must not reset the credentials they
        // already use.
        existing
      : await db.user.create({
          data: {
            tenantId: input.tenantId,
            email,
            roles,
            passwordHash,
            mustChangePassword: true,
          },
        });

    await db.userAccountLink.upsert({
      where: {
        tenantId_userId_sapKunnr: {
          tenantId: input.tenantId,
          userId: user.id,
          sapKunnr: input.kunnr,
        },
      },
      update: {},
      create: { tenantId: input.tenantId, userId: user.id, sapKunnr: input.kunnr },
    });

    return {
      userId: user.id,
      email,
      temporaryPassword: existing ? "" : password,
      created: !existing,
    };
  });
}
