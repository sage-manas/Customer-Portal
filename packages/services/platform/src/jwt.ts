import type { Role } from "@cc/domain";
import { isPlatformRole, isRole } from "@cc/domain";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import { PlatformError } from "./errors";

/**
 * Operator session tokens. Same shape of idea as `@cc/service-identity`'s
 * JWT module, and deliberately not that module: a distinct issuer/audience
 * means a tenant session token can never verify here and vice versa, which
 * is the actual security property "separate realm" is asking for — not just
 * a different cookie name (docs/DECISIONS.md ADR-045).
 */

export const OPERATOR_ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
export const OPERATOR_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Claim shape-version, the operator-realm twin of `@cc/service-identity`'s
 * `CLAIM_VERSION` (doc 09 §4.3).
 *
 * 1 → the single implicit operator role: every session could do everything
 * the console offered, because the console offered one thing.
 * 2 → the five-tier model: the token carries platform roles, and the guard
 * asks for a permission. A version-1 token has no `roles` claim at all, so
 * accepting it would produce a session that fails every `requireOperatorPermission`
 * with a 403 nobody can act on. Rejecting it outright is a `session_invalid`,
 * which the console already handles by sending the operator to `/login`.
 */
export const OPERATOR_CLAIM_VERSION = 2;

const ISSUER = "customerconnect-ops";
const AUDIENCE = "customerconnect-ops-console";

export type OperatorTokenType = "access" | "refresh";

export interface OperatorClaims {
  operatorId: string;
  email: string;
  /**
   * Platform-plane roles only. `verifyOperatorToken` drops anything that
   * isn't one, so a token that somehow carried `client_admin` would arrive
   * here without it rather than granting a tenant permission in the
   * operator realm — plane separation enforced at the parse, not by
   * everyone downstream remembering to check.
   */
  roles: Role[];
}

export interface OperatorTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function key(secret: string): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error(
      "OPS_AUTH_SECRET must be at least 32 characters — refusing to sign with a weak key",
    );
  }
  return new TextEncoder().encode(secret);
}

async function sign(
  claims: OperatorClaims,
  type: OperatorTokenType,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({
    typ: type,
    ver: OPERATOR_CLAIM_VERSION,
    email: claims.email,
    roles: claims.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.operatorId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

export async function issueOperatorTokens(
  claims: OperatorClaims,
  secret: string,
): Promise<OperatorTokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    sign(claims, "access", secret, OPERATOR_ACCESS_TOKEN_TTL_SECONDS),
    sign(claims, "refresh", secret, OPERATOR_REFRESH_TOKEN_TTL_SECONDS),
  ]);
  return { accessToken, refreshToken, expiresIn: OPERATOR_ACCESS_TOKEN_TTL_SECONDS };
}

export async function verifyOperatorToken(
  token: string,
  secret: string,
  expected: OperatorTokenType = "access",
): Promise<OperatorClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: AUDIENCE }));
  } catch (error) {
    const expired = error instanceof Error && error.name === "JWTExpired";
    throw new PlatformError(expired ? "session_expired" : "session_invalid", { cause: error });
  }

  if (payload.typ !== expected) throw new PlatformError("session_invalid");
  if (typeof payload.sub !== "string") throw new PlatformError("session_invalid");
  // Checked before any claim is read, so a pre-restructure token is
  // "sign in again" rather than a roleless session (see OPERATOR_CLAIM_VERSION).
  if (payload.ver !== OPERATOR_CLAIM_VERSION) throw new PlatformError("session_invalid");

  return {
    operatorId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter(
          (role): role is Role => typeof role === "string" && isRole(role) && isPlatformRole(role),
        )
      : [],
  };
}
