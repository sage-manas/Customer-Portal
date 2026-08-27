import type { SessionClaims } from "@cc/domain";
import { DEMO_ACCOUNTS, claimsFor, type DemoAccount } from "@cc/service-identity";
import { cookies, headers } from "next/headers";

/**
 * Demo session handling, migrated from client/apps/web/lib/session.ts.
 *
 * The original stores an HS256 access/refresh token pair in `HttpOnly`
 * cookies and verifies the signature on every read. This phase has no
 * backend to mint or verify one, so the cookie carries the *chosen demo
 * account id* instead, and the claims are rebuilt from the account registry
 * in @cc/service-identity on every read.
 *
 * The shape of what the app receives — `SessionClaims`, with `roles`,
 * `kunnr` and `availableKunnrs` — is unchanged, which is why every page,
 * layout, guard and nav filter downstream of this file is untouched.
 *
 * The cookie is NOT `HttpOnly`: `/login` sets it from the browser without an
 * API route, and the dev role switcher reads it. That is acceptable only
 * because it is not a credential — it selects a demo persona over data that
 * is identical for everyone, and there is nothing behind it to protect.
 *
 * TODO(BACKEND):
 * Restore the real session: HttpOnly + SameSite=Lax + Secure cookies holding
 * the token pair from POST /api/auth/login, verified with AUTH_SECRET.
 */

export const ACCESS_COOKIE = "cc_demo_account";
/** The demo persona's chosen sold-to account, when they used the switcher. */
export const KUNNR_COOKIE = "cc_demo_kunnr";

const DEMO_ACCOUNT_INDEX = new Map<string, DemoAccount>(
  DEMO_ACCOUNTS.map((account) => [account.id, account]),
);

export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const accountId = store.get(ACCESS_COOKIE)?.value;
  if (!accountId) return null;

  const account = DEMO_ACCOUNT_INDEX.get(accountId);
  if (!account) return null;

  const claims = claimsFor(account);
  const override = store.get(KUNNR_COOKIE)?.value;
  // The switcher may only select an account the login is actually linked to
  // — the same rule the real `switchAccount` enforces.
  if (override && claims.availableKunnrs.includes(override)) {
    return { ...claims, kunnr: override };
  }
  return claims;
}

/**
 * Re-exported so the console's layout can keep its original import line
 * (`from "@/lib/session"`) — apps/ops had one session module, not two.
 */
export { getOperatorSession } from "./ops-session";

/** The request host, for tenant resolution (docs/02 §2). */
export async function getRequestHost(): Promise<string | null> {
  const headerList = await headers();
  return headerList.get("x-forwarded-host") ?? headerList.get("host");
}
