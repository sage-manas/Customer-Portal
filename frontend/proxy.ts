import { hasPermission, type SessionClaims } from "@cc/domain";
import { NextResponse, type NextRequest } from "next/server";

import { verifyToken } from "@/server/auth/jwt";

/**
 * Auth + route guard, merged from client/apps/web/middleware.ts and
 * client/apps/ops/middleware.ts.
 *
 * Named `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and
 * warns on the old name at build time. The export below is `proxy` for the
 * same reason.
 *
 * This is the coarse gate, not the enforcement. Every page re-checks its own
 * permission on render and every route handler re-checks its own through the
 * `route()` wrapper (docs/05 §4.3), because a middleware matcher is a list
 * somebody can forget to add to. What it buys is that an unauthenticated
 * browser is sent to the login screen instead of to a page that would redirect
 * it there one render later.
 *
 * It runs on the edge runtime, so it may not touch Prisma. `jose` verifies the
 * signature there, which is the reason the tokens are signed with it.
 */

const PUBLIC_PATHS = ["/login", "/register", "/403", "/404"];

/** Route prefixes owned by the operator console (migrated from apps/ops). */
const CONSOLE_PATHS = ["/tenants", "/sap", "/operators", "/billing"];

const ACCESS_COOKIE = "cc_access";
const OPS_ACCESS_COOKIE = "cc_ops_access";

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isConsole(pathname: string): boolean {
  return CONSOLE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function unauthorized(request: NextRequest): NextResponse {
  const loginUrl = new URL("/login", request.url);
  // Preserve where the user was heading so login can return them there.
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

/**
 * Verifies whichever realm's cookie is present.
 *
 * Signature, issuer, audience, expiry and claim version are all checked — an
 * unverified token is treated as no token, never as its unverified contents.
 */
async function readSession(
  request: NextRequest,
): Promise<{ claims: SessionClaims; realm: "web" | "ops" } | null> {
  const webToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (webToken) {
    const secret = process.env.AUTH_SECRET ?? process.env.JWT_SECRET;
    if (secret) {
      try {
        return { claims: await verifyToken(webToken, secret, "access"), realm: "web" };
      } catch {
        /* fall through to the operator cookie */
      }
    }
  }

  const opsToken = request.cookies.get(OPS_ACCESS_COOKIE)?.value;
  if (opsToken) {
    const secret = process.env.OPS_AUTH_SECRET ?? process.env.AUTH_SECRET ?? process.env.JWT_SECRET;
    if (secret) {
      try {
        return { claims: await verifyToken(opsToken, secret, "access"), realm: "ops" };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /**
   * API routes are passed straight through.
   *
   * They guard themselves — `route()` refuses an unauthenticated call with a
   * 401 and an unpermitted one with a 403 — and they must answer in JSON. A
   * redirect to /login here would hand `fetch()` a 307 to an HTML page, which
   * every caller would then fail to parse and report as a confusing error
   * instead of "your session expired". It would also break the genuinely
   * public routes (login, the onboarding applicant flow, the gateway webhook),
   * whose whole point is that they run without a session.
   */
  if (pathname.startsWith("/api/")) return NextResponse.next();

  if (isPublic(pathname)) return NextResponse.next();

  const session = await readSession(request);
  if (!session) return unauthorized(request);

  if (pathname.startsWith("/admin") && !hasPermission(session.claims, "admin:view")) {
    return NextResponse.rewrite(new URL("/403", request.url), { status: 403 });
  }

  // The console's coarse gate — `platform:operate` is its `admin:view`.
  if (isConsole(pathname) && !hasPermission(session.claims, "platform:operate")) {
    return NextResponse.rewrite(new URL("/403", request.url), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
