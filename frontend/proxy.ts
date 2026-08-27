import { hasPermission, type SessionClaims } from "@cc/domain";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth + route guard, migrated from client/apps/web/middleware.ts and merged
 * with client/apps/ops/middleware.ts.
 *
 * Named `proxy.ts`, not `middleware.ts`: Next 16 renamed the convention and
 * warns on the old name at build time. The export below is `proxy` for the
 * same reason. Behaviour is unchanged.
 *
 * What was kept, because it is what the *frontend* behaviour is:
 *   - unauthenticated requests to a non-public route redirect to /login,
 *     preserving where the user was heading via `?next=`,
 *   - `/admin/*` needs `admin:view`, rewritten to /403 when it isn't held,
 *   - the console routes need `platform:operate`, same treatment — this is
 *     apps/ops's own coarse gate, folded in with the app.
 *
 * What was dropped, because it is backend:
 *   - JWT signature verification (there is no AUTH_SECRET here),
 *   - host/tenant matching and the cross-tenant 404 rewrite (single tenant),
 *   - the per-tenant/per-IP rate limiter (@cc/observability),
 *   - the x-request-id propagation into the observability context.
 *
 * This was never *the* enforcement even in /client — the guards inside each
 * page and route handler are (docs/05 §4.3). Those came across intact, so a
 * URL typed by hand is still refused by the page itself, not only here.
 *
 * TODO(BACKEND):
 * Restore token verification, tenant/host matching and rate limiting.
 */

const PUBLIC_PATHS = ["/login", "/register", "/403", "/404"];

/** Route prefixes owned by the operator console (migrated from apps/ops). */
const CONSOLE_PATHS = ["/tenants", "/sap", "/operators", "/billing"];

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
 * Reads the demo cookie. Deliberately *not* called "verify": there is no
 * signature to check in this phase — see lib/session.ts.
 */
function readDemoSession(request: NextRequest): Pick<SessionClaims, "roles"> | null {
  const accountId = request.cookies.get("cc_demo_account")?.value;
  if (!accountId) return null;
  const roles = DEMO_ROLES[accountId];
  return roles ? { roles } : null;
}

/**
 * The account -> roles map, inlined because middleware runs on the edge
 * runtime and must stay free of the service layer's imports. It mirrors
 * DEMO_ACCOUNTS in packages/services/identity.ts.
 */
const DEMO_ROLES: Record<string, SessionClaims["roles"]> = {
  "demo-customer": ["customer"],
  "demo-client-admin": ["client_admin"],
  "demo-ap-manager": ["ap_manager"],
  "demo-ar-manager": ["ar_manager"],
  "demo-super-admin": ["super_admin"],
  "demo-sap-manager": ["sap_manager"],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = readDemoSession(request);
  if (!session) return unauthorized(request);

  if (pathname.startsWith("/admin") && !hasPermission(session, "admin:view")) {
    return NextResponse.rewrite(new URL("/403", request.url), { status: 403 });
  }

  // The console's coarse gate — `platform:operate` is its `admin:view`.
  if (isConsole(pathname) && !hasPermission(session, "platform:operate")) {
    return NextResponse.rewrite(new URL("/403", request.url), { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
