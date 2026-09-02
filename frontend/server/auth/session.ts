import "server-only";

import type { SessionClaims } from "@cc/domain";
import { cookies, headers } from "next/headers";

import { serverEnv } from "../env";
import { AuthError } from "./errors";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  issueTokens,
  verifyToken,
  type TokenPair,
} from "./jwt";

/**
 * Session cookies for both realms.
 *
 * The two planes keep separate cookie names and are signed with separate
 * secrets (ADR-045), so one browser can hold a tenant session and an operator
 * session at once and neither realm's token verifies in the other.
 *
 * Every cookie here is `HttpOnly`: the token is a credential, and script that
 * can read it can replay it. This is the substantive difference from the
 * Phase 1 demo cookie, which the browser wrote and read itself.
 */

export const ACCESS_COOKIE = "cc_access";
export const REFRESH_COOKIE = "cc_refresh";
export const OPS_ACCESS_COOKIE = "cc_ops_access";
export const OPS_REFRESH_COOKIE = "cc_ops_refresh";

export type Realm = "web" | "ops";

interface RealmConfig {
  access: string;
  refresh: string;
  secret: string;
}

export function realmConfig(realm: Realm): RealmConfig {
  return realm === "ops"
    ? {
        access: OPS_ACCESS_COOKIE,
        refresh: OPS_REFRESH_COOKIE,
        secret: serverEnv.OPS_AUTH_SECRET,
      }
    : { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE, secret: serverEnv.AUTH_SECRET };
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Lax rather than Strict so following a link into the portal from an
    // email still arrives signed in; the mutations are all same-origin.
    secure: serverEnv.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function establishSession(claims: SessionClaims, realm: Realm = "web"): Promise<void> {
  const config = realmConfig(realm);
  const tokens = await issueTokens(claims, config.secret);
  const store = await cookies();
  store.set(config.access, tokens.accessToken, cookieOptions(ACCESS_TOKEN_TTL_SECONDS));
  store.set(config.refresh, tokens.refreshToken, cookieOptions(REFRESH_TOKEN_TTL_SECONDS));
}

export async function clearSession(realm: Realm = "web"): Promise<void> {
  const config = realmConfig(realm);
  const store = await cookies();
  store.delete(config.access);
  store.delete(config.refresh);
}

/**
 * The session behind the current request, or null.
 *
 * Returns null rather than throwing on an expired or malformed token: a page
 * asking "is anyone signed in?" wants an answer, and the redirect to /login is
 * the caller's decision. `requireSession` is the throwing form.
 */
export async function readSession(realm: Realm = "web"): Promise<SessionClaims | null> {
  const config = realmConfig(realm);
  const store = await cookies();
  const token = store.get(config.access)?.value;
  if (!token) return null;

  try {
    return await verifyToken(token, config.secret, "access");
  } catch {
    return null;
  }
}

/**
 * Exchanges a valid refresh token for a new pair.
 *
 * The claims are re-read from the refresh token rather than from the expired
 * access token, and callers are expected to re-derive roles from the database
 * before calling this — a refresh must not be able to extend a session whose
 * user has since been deactivated.
 */
export async function readRefreshClaims(realm: Realm = "web"): Promise<SessionClaims> {
  const config = realmConfig(realm);
  const store = await cookies();
  const token = store.get(config.refresh)?.value;
  if (!token) throw new AuthError("unauthenticated");
  return verifyToken(token, config.secret, "refresh");
}

export async function mintTokens(claims: SessionClaims, realm: Realm = "web"): Promise<TokenPair> {
  return issueTokens(claims, realmConfig(realm).secret);
}

/** The request host, for tenant resolution (docs/02 §2). */
export async function requestHost(): Promise<string | null> {
  const headerList = await headers();
  return headerList.get("x-forwarded-host") ?? headerList.get("host");
}
