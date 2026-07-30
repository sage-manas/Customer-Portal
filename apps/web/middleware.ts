import { hasPermission, type SessionClaims } from "@cc/domain";
import { createRateLimiter } from "@cc/observability/rate-limit";
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
// `/api/onboarding/*` is public for the same reason `/register` is: an
// applicant has no portal user until their account is approved. Those
// handlers are not unguarded — the tenant comes from the host and the
// application from an unguessable draft token (docs/DECISIONS.md ADR-009).
// `/api/admin/onboarding/*` is deliberately NOT in this list.
// `/api/webhooks/*` is public because the caller is a payment gateway, not a
// person — there is no session to check. Those handlers authenticate the
// *request* instead, by verifying an HMAC signature over the raw body before
// parsing it (docs/02 §6); an unsigned body never reaches any logic.
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/onboarding",
  "/api/webhooks",
  "/api/health",
  "/403",
  "/404",
];

// Never rate-limited: a health check is infra polling the process, not a
// user or tenant making requests, and it needs to answer even when a tenant
// (or an attacker pretending to be one) is being throttled.
const UNTHROTTLED_PATHS = ["/api/health"];

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

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Per-tenant/per-IP rate limiting (docs/07 B3). `@cc/observability/rate-limit`
 * is a separate subpath specifically so this import never drags `pino` or
 * OpenTelemetry into the edge bundle — see that package's README.
 *
 * A module-level limiter, not one created per request: the edge runtime
 * keeps an isolate warm across requests, and a fresh limiter per call would
 * never accumulate a count. It is still only correct *within* one isolate —
 * an accepted gap for this phase, not a silent one (see the package README).
 */
const rateLimiter = createRateLimiter();
const PUBLIC_RATE_LIMIT = { limit: 60, windowMs: 60_000 }; // per IP, unauthenticated
const TENANT_RATE_LIMIT = { limit: 600, windowMs: 60_000 }; // per tenant, authenticated

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function tooManyRequests(resetAtMs: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(Math.ceil((resetAtMs - Date.now()) / 1000)) } },
  );
}

function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = crypto.randomUUID();
  // Forwarded to the route handler as a *request* header (not just on the
  // response), so `apps/web/lib/*-route.ts` can read it via `next/headers`
  // and correlate every log line for this request without regenerating one.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);
  const next = () => NextResponse.next({ request: { headers: forwardedHeaders } });

  if (isPublic(pathname)) {
    if (!UNTHROTTLED_PATHS.includes(pathname)) {
      const result = await rateLimiter.consume(
        `ip:${clientIp(request)}`,
        PUBLIC_RATE_LIMIT.limit,
        PUBLIC_RATE_LIMIT.windowMs,
      );
      if (!result.allowed) return withRequestId(tooManyRequests(result.resetAtMs), requestId);
    }
    return withRequestId(next(), requestId);
  }

  const token = request.cookies.get("cc_access")?.value;
  if (!token) return withRequestId(unauthorized(request), requestId);

  let session: SessionClaims;
  try {
    session = await verifyToken(token, process.env.AUTH_SECRET ?? "");
  } catch {
    return withRequestId(unauthorized(request), requestId);
  }

  // A token issued for tenant A must not work on tenant B's host, however
  // valid its signature. Mismatch is a 404, never a 403: confirming that
  // another tenant's portal exists is itself a leak (docs/05 §8).
  const resolution = resolveTenantFromHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    process.env.ROOT_DOMAIN ?? "localhost",
  );
  if (!hostMatchesSession(resolution, session)) {
    return withRequestId(
      NextResponse.rewrite(new URL("/404", request.url), { status: 404 }),
      requestId,
    );
  }

  if (pathname.startsWith("/admin") && !hasPermission(session, "admin:view")) {
    return withRequestId(
      NextResponse.rewrite(new URL("/403", request.url), { status: 403 }),
      requestId,
    );
  }

  const result = await rateLimiter.consume(
    `tenant:${session.tenantId}`,
    TENANT_RATE_LIMIT.limit,
    TENANT_RATE_LIMIT.windowMs,
  );
  if (!result.allowed) return withRequestId(tooManyRequests(result.resetAtMs), requestId);

  return withRequestId(next(), requestId);
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
