import type { SessionClaims } from "@cc/domain";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  verifyToken,
  type TokenPair,
} from "@cc/service-identity";
import { cookies, headers } from "next/headers";

import { env } from "./env";

/**
 * Session cookie handling for the BFF.
 *
 * Tokens live in `HttpOnly`, `SameSite=Lax`, `Secure` (in production)
 * cookies rather than `localStorage`: the portal renders on the server and
 * an XSS-readable token would be a full tenant compromise (docs/02 §9).
 */

export const ACCESS_COOKIE = "cc_access";
export const REFRESH_COOKIE = "cc_refresh";

/** Built per call, not at module scope: `env` is validated lazily so that
 * `next build` can import this module without runtime secrets present. */
function baseCookie() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}

export async function setSessionCookies(tokens: TokenPair): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookie(),
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  store.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookie(),
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

/**
 * Reads and verifies the current session. Returns null instead of throwing
 * so pages can redirect; route handlers should use `requireSession` from
 * @cc/service-identity on the result to get a typed 401 instead.
 */
export async function getSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifyToken(token, env.AUTH_SECRET);
  } catch {
    return null;
  }
}

/** The request host, for tenant resolution (docs/02 §2). */
export async function getRequestHost(): Promise<string | null> {
  const headerList = await headers();
  return headerList.get("x-forwarded-host") ?? headerList.get("host");
}
