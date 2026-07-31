import {
  OPERATOR_ACCESS_TOKEN_TTL_SECONDS,
  OPERATOR_REFRESH_TOKEN_TTL_SECONDS,
  verifyOperatorToken,
  type OperatorClaims,
  type OperatorTokenPair,
} from "@cc/service-platform";
import { cookies } from "next/headers";

import { env } from "./env";

/**
 * Session cookie handling for the operator console. Separate cookie names
 * from apps/web's (`cc_access`/`cc_refresh`) so the two realms can even sit
 * on the same browser without one clobbering the other, though in practice
 * they run on different hosts entirely (docs/DECISIONS.md ADR-045).
 */

export const OPS_ACCESS_COOKIE = "cc_ops_access";
export const OPS_REFRESH_COOKIE = "cc_ops_refresh";

function baseCookie() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}

export async function setOperatorSessionCookies(tokens: OperatorTokenPair): Promise<void> {
  const store = await cookies();
  store.set(OPS_ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie(),
    maxAge: OPERATOR_ACCESS_TOKEN_TTL_SECONDS,
  });
  store.set(OPS_REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie(),
    maxAge: OPERATOR_REFRESH_TOKEN_TTL_SECONDS,
  });
}

export async function clearOperatorSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(OPS_ACCESS_COOKIE);
  store.delete(OPS_REFRESH_COOKIE);
}

export async function getOperatorSession(): Promise<OperatorClaims | null> {
  const token = (await cookies()).get(OPS_ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyOperatorToken(token, env.OPS_AUTH_SECRET);
  } catch {
    return null;
  }
}
