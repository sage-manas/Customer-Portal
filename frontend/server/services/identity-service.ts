import "server-only";

import { isPlatformRole, type Role, type SessionClaims } from "@cc/domain";

import { AuthError } from "../auth/errors";
import { hashPassword, needsRehash, verifyPassword } from "../auth/password";
import * as repo from "../repositories/identity-repository";

/**
 * Authentication for the tenant/customer plane.
 *
 * The rules that matter here, in the order they are applied:
 *
 *  1. Every failure before a session exists answers `bad_credentials` with the
 *     same sentence. A distinct "no such user" would turn the login form into
 *     an account-enumeration oracle for a portal whose user list is its
 *     customer list.
 *  2. A deactivated tenant or user cannot sign in — that is what
 *     deactivation *is*, and enforcing it only in the UI would leave the API
 *     open.
 *  3. The active sold-to account is chosen from the user's own links and
 *     never from anything the caller sent.
 */

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  session: SessionClaims;
  mustChangePassword: boolean;
}

/** A tenant-plane session must not carry a platform role, and vice versa. */
function tenantRoles(roles: Role[]): Role[] {
  return roles.filter((role) => !isPlatformRole(role));
}

export async function login(tenantId: string, input: LoginInput): Promise<LoginResult> {
  const user = await repo.findUserByEmail(tenantId, input.email);

  // Verify against the stored hash even when there is no user, so a missing
  // account and a wrong password take the same time to refuse. `verifyPassword`
  // returns false for a null hash rather than throwing, which is what makes
  // this safe to call unconditionally.
  const passwordOk = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !passwordOk) throw new AuthError("bad_credentials");

  if (!user.tenant.isActive) throw new AuthError("tenant_inactive");
  if (!user.isActive) throw new AuthError("account_inactive");

  const roles = tenantRoles(user.roles);
  if (roles.length === 0) throw new AuthError("forbidden");

  const availableKunnrs = await activeAccountsFor(
    tenantId,
    user.accountLinks.map((link) => link.sapKunnr),
  );

  // A password that verified under weaker parameters is upgraded in place.
  // Best-effort: this must not fail a login that has already succeeded.
  if (needsRehash(user.passwordHash)) {
    void repo
      .updatePasswordHash(user.id, await hashPassword(input.password))
      .catch(() => undefined);
  }
  void repo.recordLogin(user.id).catch(() => undefined);

  return {
    session: {
      userId: user.id,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      email: user.email,
      roles,
      kunnr: availableKunnrs[0],
      availableKunnrs,
    },
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Filters a user's links down to accounts that may still use the portal.
 *
 * Deactivating a customer account has to remove it here rather than only at
 * the screens, or a user linked to two accounts could keep trading on the
 * switched-off one just by selecting it.
 */
async function activeAccountsFor(tenantId: string, kunnrs: string[]): Promise<string[]> {
  const checks = await Promise.all(
    kunnrs.map(async (kunnr) =>
      (await repo.isCustomerAccountActive(tenantId, kunnr)) ? kunnr : null,
    ),
  );
  return checks.filter((kunnr): kunnr is string => kunnr !== null);
}

/**
 * Signs in as a user without checking a password.
 *
 * This exists for the development role picker, which is how the six roles get
 * exercised without six sign-ins. It is dangerous by construction, so it is
 * guarded twice and independently: the route that calls it 404s outside
 * development, and this function refuses outright in production. Either guard
 * alone would be enough; both are here because the cost of one of them being
 * edited away by accident is every account in the portal.
 */
export async function signInWithoutPassword(
  tenantId: string,
  email: string,
): Promise<SessionClaims> {
  if (process.env.NODE_ENV === "production") {
    throw new AuthError("bad_credentials");
  }

  const user = await repo.findUserByEmail(tenantId, email);
  if (!user || !user.isActive || !user.tenant.isActive) throw new AuthError("bad_credentials");

  const roles = tenantRoles(user.roles);
  if (roles.length === 0) throw new AuthError("forbidden");

  const availableKunnrs = await activeAccountsFor(
    tenantId,
    user.accountLinks.map((link) => link.sapKunnr),
  );

  return {
    userId: user.id,
    tenantId: user.tenantId,
    tenantSlug: user.tenant.slug,
    email: user.email,
    roles,
    kunnr: availableKunnrs[0],
    availableKunnrs,
  };
}

/**
 * The operator-realm equivalent, under the same two guards.
 */
export async function operatorSignInWithoutPassword(email: string): Promise<SessionClaims> {
  if (process.env.NODE_ENV === "production") {
    throw new AuthError("bad_credentials");
  }

  const operator = await repo.findOperatorByEmail(email);
  if (!operator || !operator.isActive) throw new AuthError("bad_credentials");

  const roles = operator.roles.filter(isPlatformRole);
  if (roles.length === 0) throw new AuthError("forbidden");

  return {
    userId: operator.id,
    tenantId: "",
    tenantSlug: "",
    email: operator.email,
    roles,
    availableKunnrs: [],
  };
}

/**
 * Switches the active sold-to account.
 *
 * Re-read from the database rather than trusted from the token: a link
 * revoked, or an account deactivated, after the session was issued must take
 * effect on the next switch rather than at the next sign-in.
 */
export async function switchAccount(session: SessionClaims, kunnr: string): Promise<SessionClaims> {
  const user = await repo.findUserById(session.tenantId, session.userId);
  if (!user || !user.isActive) throw new AuthError("session_invalid");

  const linked = user.accountLinks.some((link) => link.sapKunnr === kunnr);
  if (!linked) throw new AuthError("forbidden");
  if (!(await repo.isCustomerAccountActive(session.tenantId, kunnr))) {
    throw new AuthError("account_inactive");
  }

  const availableKunnrs = await activeAccountsFor(
    session.tenantId,
    user.accountLinks.map((link) => link.sapKunnr),
  );

  return { ...session, kunnr, availableKunnrs };
}

/**
 * Rebuilds claims from the database for a session that already verified.
 *
 * Used on refresh: a token is proof the user authenticated, never proof of
 * what they may still do. Roles, links and both active flags are re-read.
 */
export async function refreshClaims(session: SessionClaims): Promise<SessionClaims> {
  const user = await repo.findUserById(session.tenantId, session.userId);
  if (!user || !user.isActive || !user.tenant.isActive) throw new AuthError("session_invalid");

  const roles = tenantRoles(user.roles);
  if (roles.length === 0) throw new AuthError("session_invalid");

  const availableKunnrs = await activeAccountsFor(
    session.tenantId,
    user.accountLinks.map((link) => link.sapKunnr),
  );
  const kunnr =
    session.kunnr && availableKunnrs.includes(session.kunnr) ? session.kunnr : availableKunnrs[0];

  return {
    userId: user.id,
    tenantId: user.tenantId,
    tenantSlug: user.tenant.slug,
    email: user.email,
    roles,
    kunnr,
    availableKunnrs,
  };
}

// ---------------------------------------------------------------------------
// Platform plane
// ---------------------------------------------------------------------------

export interface OperatorClaims {
  operatorId: string;
  email: string;
  roles: Role[];
}

/**
 * The operator realm's login. Separate table, separate signing key (ADR-045),
 * and it grants only platform roles: an operator row that somehow carried a
 * tenant role must not be able to use it here.
 */
export async function operatorLogin(input: LoginInput): Promise<SessionClaims> {
  const operator = await repo.findOperatorByEmail(input.email);
  const passwordOk = await verifyPassword(input.password, operator?.passwordHash);
  if (!operator || !passwordOk) throw new AuthError("bad_credentials");
  if (!operator.isActive) throw new AuthError("account_inactive");

  const roles = operator.roles.filter(isPlatformRole);
  if (roles.length === 0) throw new AuthError("forbidden");

  void repo.recordOperatorLogin(operator.id).catch(() => undefined);

  // Carried as SessionClaims so one `hasPermission` path serves both planes.
  // The tenant fields are empty by construction: a platform session is scoped
  // to no tenant and holds no tenant data permission.
  return {
    userId: operator.id,
    tenantId: "",
    tenantSlug: "",
    email: operator.email,
    roles,
    availableKunnrs: [],
  };
}
