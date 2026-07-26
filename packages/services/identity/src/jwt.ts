import type { Role, SessionClaims } from "@cc/domain";
import { ROLES } from "@cc/domain";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import { AuthError } from "./errors";

/**
 * Session tokens: short-lived access JWT + longer-lived refresh token
 * (docs/02-TRD-ARCHITECTURE.md §3). Claims carry `tenantId`, the active
 * `kunnr` and `roles`, which is what the tenant middleware and the RBAC
 * guard read on every request.
 *
 * `jose` (not `jsonwebtoken`) because verification also runs in Next's
 * middleware on the edge runtime, where Node's `crypto` module isn't
 * available — the tenant/auth guard has to work there or it isn't a guard.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 30 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const ISSUER = "customerconnect-portal";
const AUDIENCE = "customerconnect-web";

export type TokenType = "access" | "refresh";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function key(secret: string): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be at least 32 characters — refusing to sign with a weak key",
    );
  }
  return new TextEncoder().encode(secret);
}

async function sign(
  claims: SessionClaims,
  type: TokenType,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({
    typ: type,
    tenantId: claims.tenantId,
    tenantSlug: claims.tenantSlug,
    email: claims.email,
    roles: claims.roles,
    kunnr: claims.kunnr,
    availableKunnrs: claims.availableKunnrs,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

export async function issueTokens(claims: SessionClaims, secret: string): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    sign(claims, "access", secret, ACCESS_TOKEN_TTL_SECONDS),
    sign(claims, "refresh", secret, REFRESH_TOKEN_TTL_SECONDS),
  ]);
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Verifies signature, issuer/audience, expiry *and* the claim shape. An
 * unrecognised role is dropped rather than trusted: claims are attacker-
 * adjacent input, and a role that no longer exists must never widen access.
 */
export async function verifyToken(
  token: string,
  secret: string,
  expected: TokenType = "access",
): Promise<SessionClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: AUDIENCE }));
  } catch (error) {
    const expired = error instanceof Error && error.name === "JWTExpired";
    throw new AuthError(expired ? "session_expired" : "session_invalid", { cause: error });
  }

  if (payload.typ !== expected) throw new AuthError("session_invalid");
  if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string") {
    throw new AuthError("session_invalid");
  }

  const roles = Array.isArray(payload.roles) ? payload.roles.filter(isRole) : [];
  const availableKunnrs = Array.isArray(payload.availableKunnrs)
    ? payload.availableKunnrs.filter((value): value is string => typeof value === "string")
    : [];

  return {
    userId: payload.sub,
    tenantId: payload.tenantId,
    tenantSlug: typeof payload.tenantSlug === "string" ? payload.tenantSlug : "",
    email: typeof payload.email === "string" ? payload.email : "",
    roles,
    kunnr: typeof payload.kunnr === "string" ? payload.kunnr : undefined,
    availableKunnrs,
  };
}
