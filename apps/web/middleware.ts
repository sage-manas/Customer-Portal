import { hasPermission, type SessionClaims } from "@cc/domain";
import { hostMatchesSession, resolveTenantFromHost, verifyToken } from "@cc/service-identity/edge";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth + tenant guard (docs/02-TRD-ARCHITECTURE.md §2/§3).
 *
 * Runs on every non-public route before any page or handler:
 *  1. verifies the access token,
 *  2. checks the host's tenant matches the token's tenant claim,
 *  3. checks the coarse route permission (`/admin/*` needs `admin:view`).
 *
 * This is a gate, not *the* enforcement: route handlers still call
 * `requirePermission` themselves (docs/05 §4.3 — "the API enforces"), and
 * every DB query is tenant-scoped regardless. Middleware exists so an
 * unauthenticated user gets a redirect instead of a rendered shell.
 *
 * Runs on the edge runtime, hence the `/edge` import — no Prisma here.
 */

// `/api/auth/logout` is public deliberately: signing out must work even when
// the token has already expired, or a stale session cookie can never be
// cleared. It only deletes cookies, so there is nothing to authorize.
const PUBLIC_PATHS = ["/login", "/register", "/api/auth/login", "/api/auth/logout", "/403", "/404"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function unauthorized(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  // Preserve where the user was heading so login can return them there.
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get("cc_access")?.value;
  if (!token) return unauthorized(request);

  let session: SessionClaims;
  try {
    session = await verifyToken(token, process.env.AUTH_SECRET ?? "");
  } catch {
    return unauthorized(request);
  }

  // A token issued for tenant A must not work on tenant B's host, however
  // valid its signature. Mismatch is a 404, never a 403: confirming that
  // another tenant's portal exists is itself a leak (docs/05 §8).
  const resolution = resolveTenantFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    process.env.ROOT_DOMAIN ?? "localhost",
  );
  if (!hostMatchesSession(resolution, session)) {
    return NextResponse.rewrite(new URL("/404", request.url), { status: 404 });
  }

  if (pathname.startsWith("/admin") && !hasPermission(session, "admin:view")) {
    return NextResponse.rewrite(new URL("/403", request.url), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
