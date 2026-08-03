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

const ISSUER = "customerconnect-ops";
const AUDIENCE = "customerconnect-ops-console";

export type OperatorTokenType = "access" | "refresh";

export interface OperatorClaims {
  operatorId: string;
  email: string;
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
  return new SignJWT({ typ: type, email: claims.email })
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

  return {
    operatorId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
  };
}
