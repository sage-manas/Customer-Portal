"use client";

import { sessionPlane } from "@cc/domain";
import { DEMO_ACCOUNTS, type DemoAccount } from "@cc/service-identity";

/**
 * Browser-side demo authentication.
 *
 * The phase brief is explicit that signing in must not call the backend, hit
 * a database, or need an API endpoint — so it doesn't. Choosing a demo
 * account writes a cookie, and `lib/session.ts` rebuilds the real
 * `SessionClaims` from it on the server. Everything downstream — the nav
 * filter, the page guards, the 403s — is the migrated code, unchanged.
 *
 * This is NOT an authentication boundary: the cookie names a persona, the
 * data behind every persona is the same seeded landscape, and there is
 * nothing to protect. Treating it as one would be a mistake.
 *
 * TODO(BACKEND):
 * Replace with the real login. Expected endpoint: POST /api/auth/login,
 * setting HttpOnly cc_access/cc_refresh cookies (see @cc/service-identity).
 */

const ACCOUNT_COOKIE = "cc_demo_account";
const KUNNR_COOKIE = "cc_demo_kunnr";
/** A week — long enough that a demo doesn't sign itself out mid-walkthrough. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function readDemoAccountId(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)cc_demo_account=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function signInAs(account: DemoAccount): void {
  setCookie(ACCOUNT_COOKIE, account.id);
  // A persona change must not carry the previous one's chosen sold-to.
  clearCookie(KUNNR_COOKIE);
}

export function signOut(): void {
  clearCookie(ACCOUNT_COOKIE);
  clearCookie(KUNNR_COOKIE);
}

export function switchKunnr(kunnr: string): void {
  setCookie(KUNNR_COOKIE, kunnr);
}

/**
 * Where a session lands after signing in, derived from its plane exactly as
 * the migrated layouts derive it (ADR-062) rather than from a role name.
 */
export function landingPathFor(account: DemoAccount): string {
  switch (sessionPlane({ roles: account.roles })) {
    case "platform":
      // The console root in /client forwarded to the first tab the operator
      // could open; `/tenants` is that tab for `super_admin`, and
      // `sap_manager` is redirected on from there by the page guard.
      return account.roles.includes("super_admin") ? "/tenants" : "/sap/config";
    case "back_office":
      return "/admin";
    default:
      return "/";
  }
}

export function findAccountByEmail(email: string): DemoAccount | undefined {
  const needle = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((account) => account.email.toLowerCase() === needle);
}

export { DEMO_ACCOUNTS };
export type { DemoAccount };
