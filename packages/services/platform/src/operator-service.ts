import { db } from "@cc/db";
import type { Role } from "@cc/domain";
import { isPlatformRole, isRole } from "@cc/domain";

import { PlatformError } from "./errors";
import { issueOperatorTokens, type OperatorClaims, type OperatorTokenPair } from "./jwt";
import { hashPassword, verifyPassword } from "./password";

/**
 * Operator login. Mirrors the shape of `@cc/service-identity`'s `login`
 * (same constant-time-failure reasoning), but reads `Operator` — a
 * platform-plane table with no tenant to resolve first.
 */

/** A syntactically valid hash nothing will ever match — see identity-service.ts's twin. */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "Y2Fubm90LW1hdGNoLWFueXRoaW5nLWV2ZXItYmVjYXVzZS1yYW5kb20tcGFkZGluZy0wMDAwMDA=";

export interface OperatorLoginResult {
  claims: OperatorClaims;
  tokens: OperatorTokenPair;
  mustChangePassword: boolean;
}

export async function operatorLogin(
  emailInput: string,
  password: string,
  secret: string,
): Promise<OperatorLoginResult> {
  const email = emailInput.trim().toLowerCase();
  const operator = await db.operator.findFirst({ where: { email } });

  const passwordOk = await verifyPassword(password, operator?.passwordHash ?? DUMMY_HASH);
  if (!operator || !passwordOk) throw new PlatformError("invalid_credentials");
  if (!operator.isActive) throw new PlatformError("account_inactive");

  await db.operator.update({ where: { id: operator.id }, data: { lastLoginAt: new Date() } });

  // Filtered rather than cast: the column is a `UserRole[]`, which the
  // portal's roles share, and only a platform role has any meaning in this
  // realm (doc 09 §1). A row misconfigured with `client_admin` signs in
  // with that role dropped, not with a tenant permission in the console.
  const roles: Role[] = operator.roles.filter(
    (role): role is Role => isRole(role) && isPlatformRole(role),
  );
  if (roles.length === 0) throw new PlatformError("forbidden");

  const claims: OperatorClaims = { operatorId: operator.id, email: operator.email, roles };
  return {
    claims,
    tokens: await issueOperatorTokens(claims, secret),
    mustChangePassword: operator.mustChangePassword,
  };
}

export async function setOperatorPassword(operatorId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 12) throw new PlatformError("invalid_credentials");
  const passwordHash = await hashPassword(newPassword);
  await db.operator.update({
    where: { id: operatorId },
    data: { passwordHash, mustChangePassword: false },
  });
}
