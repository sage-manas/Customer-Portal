import { randomBytes } from "node:crypto";

import { db } from "@cc/db";
import type { Role } from "@cc/domain";
import { isPlatformRole, isRole, rolesWithPermission } from "@cc/domain";

import { PlatformError } from "./errors";
import { hashPassword } from "./password";

/**
 * Operator-user management (doc 09 §3.3) — `super_admin` only, and the
 * reason that role exists separately from `sap_manager` at all: the ability
 * to create console logins is the ability to create any console login.
 *
 * The plane constraint is enforced here rather than trusted from the
 * caller, for the third time in this package and deliberately so: the token
 * parse drops non-platform roles, `operatorLogin` refuses a row that has
 * none, and this refuses to *write* one. Each of the three covers a
 * different moment — a forged claim, a row edited by hand, and a bug in the
 * console's own form — and none of them is load-bearing alone (ADR-051).
 */

export interface OperatorListItem {
  id: string;
  email: string;
  roles: Role[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateOperatorInput {
  email: string;
  roles: Role[];
}

export interface CreateOperatorResult {
  operator: OperatorListItem;
  /** Shown once to the creating operator; only its scrypt hash is stored. */
  temporaryPassword: string;
}

function toListItem(operator: {
  id: string;
  email: string;
  roles: string[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}): OperatorListItem {
  return {
    id: operator.id,
    email: operator.email,
    // Filtered, not cast — the same treatment `operatorLogin` gives the
    // column. A row holding a tenant role reads back without it, so the
    // list cannot display a permission the console would never honour.
    roles: operator.roles.filter((role): role is Role => isRole(role) && isPlatformRole(role)),
    isActive: operator.isActive,
    mustChangePassword: operator.mustChangePassword,
    lastLoginAt: operator.lastLoginAt,
    createdAt: operator.createdAt,
  };
}

export async function listOperators(): Promise<OperatorListItem[]> {
  const operators = await db.operator.findMany({ orderBy: { createdAt: "asc" } });
  return operators.map(toListItem);
}

export async function createOperator(input: CreateOperatorInput): Promise<CreateOperatorResult> {
  const email = input.email.trim().toLowerCase();

  const roles = input.roles.filter((role) => isRole(role) && isPlatformRole(role));
  if (roles.length === 0) {
    throw new PlatformError("forbidden", {
      detail: "An operator must hold at least one platform role.",
    });
  }

  const existing = await db.operator.findUnique({ where: { email } });
  if (existing) throw new PlatformError("operator_email_taken");

  const temporaryPassword = randomBytes(18).toString("base64url");
  const operator = await db.operator.create({
    data: {
      email,
      passwordHash: await hashPassword(temporaryPassword),
      roles,
      mustChangePassword: true,
    },
  });

  return { operator: toListItem(operator), temporaryPassword };
}

/**
 * Deactivates or reactivates a console login. Not a delete, for the same
 * reason tenants are not deleted (ADR-054) — and one more: the SAP
 * configuration trail records an `operatorId`, and an operator row that can
 * vanish is an audit entry that can lose its subject.
 */
export async function setOperatorActive(
  operatorId: string,
  isActive: boolean,
  actingOperatorId: string,
): Promise<OperatorListItem> {
  if (operatorId === actingOperatorId && !isActive) {
    // Not paternalism: the console has no other way back in if the last
    // super admin locks themselves out, and "restore an operator" is a
    // database task rather than a screen.
    throw new PlatformError("forbidden", {
      detail: "You cannot deactivate the account you are signed in with.",
    });
  }

  const operator = await db.operator.findUnique({ where: { id: operatorId } });
  if (!operator) throw new PlatformError("not_found");

  if (!isActive) {
    // The same lockout one step out: deactivating somebody else is fine
    // right up until they are the last account that could have undone it.
    // The role set comes from the registry rather than being spelled
    // `super_admin` here, so granting `platform:operators-manage` to a
    // future role widens the escape hatch with nothing to edit (rule 5).
    const managerRoles = rolesWithPermission("platform:operators-manage");
    const remaining = await db.operator.count({
      where: { isActive: true, roles: { hasSome: managerRoles }, NOT: { id: operatorId } },
    });
    if (remaining === 0) {
      throw new PlatformError("forbidden", {
        detail:
          "This is the last active operator who can manage operators — deactivating it would lock the console.",
      });
    }
  }

  const updated = await db.operator.update({ where: { id: operatorId }, data: { isActive } });
  return toListItem(updated);
}
