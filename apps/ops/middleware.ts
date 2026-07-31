import { verifyOperatorToken } from "@cc/service-platform/edge";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Operator-realm auth gate. Much smaller than apps/web's middleware: there
 * is no tenant to resolve from the host (an operator isn't scoped to one),
 * no per-role route split (every operator session is the same single role),
 * and no rate limiter yet — a "minimal but real" console (docs/07 B5) rather
 * than a second copy of every web hardening measure.
 *
 * Runs on the edge runtime, hence `@cc/service-platform`'s JWT module having
 * no Prisma/`node:crypto`-only dependency of its own (it uses `jose`, same
 * as `@cc/service-identity/edge`).
 */

// `/api/auth/logout` is public deliberately, for the same reason apps/web's
// is: signing out must work even when the token has already expired, or a
// stale/invalid session cookie can never be cleared through the API. It
// only deletes cookies, so there is nothing to authorize (docs/07 B6's
// authz sweep caught this as a gap — apps/web already had the exception,
// apps/ops's middleware was written without it).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function unauthorized(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get("cc_ops_access")?.value;
  if (!token) return unauthorized(request);

  try {
    await verifyOperatorToken(token, process.env.OPS_AUTH_SECRET ?? "");
  } catch {
    return unauthorized(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
