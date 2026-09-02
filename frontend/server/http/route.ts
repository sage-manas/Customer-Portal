import "server-only";

import { hasPermission, type Permission, type SessionClaims } from "@cc/domain";
import { NextResponse, type NextRequest } from "next/server";

import { AuthError } from "../auth/errors";
import { readSession, type Realm } from "../auth/session";

import { toErrorResponse } from "./respond";

/**
 * The wrapper every route handler is defined through.
 *
 * It exists so the order in the architecture — authenticate, authorize,
 * validate, then call a service — is expressed once instead of being retyped,
 * and occasionally mistyped, in a hundred files. A handler that forgets its
 * guard cannot exist: the guard is a required argument, not a call the author
 * has to remember to make first.
 *
 * The permission the handler declares here is the same one
 * `API_ROUTES` in @cc/domain declares as data. That registry is the
 * *declaration*; this is the *enforcement*. Keeping both is what lets a test
 * assert they agree — a handler guarding something other than what it
 * advertises is then a failing test rather than a code-review note.
 */

export interface RouteContext<P extends Record<string, string> = Record<string, string>> {
  request: NextRequest;
  url: URL;
  params: P;
  /** Non-null whenever the guard is `session` or a permission. */
  session: SessionClaims;
  tenantId: string;
}

/** A route reachable without a session, and why. Public is never a bare flag. */
interface PublicGuard {
  kind: "public";
  reason: string;
}

interface SessionGuard {
  kind: "session";
}

interface PermissionGuard {
  kind: "permission";
  permission: Permission;
}

export type Guard = PublicGuard | SessionGuard | PermissionGuard;

export interface RouteOptions {
  guard: Guard;
  /** Which realm's cookie and secret authenticate the caller (ADR-045). */
  realm?: Realm;
}

type Handler<P extends Record<string, string>> = (
  context: RouteContext<P>,
) => Promise<Response | unknown>;

type PublicHandler<P extends Record<string, string>> = (
  context: Omit<RouteContext<P>, "session" | "tenantId"> & {
    session: SessionClaims | null;
  },
) => Promise<Response | unknown>;

/**
 * Next 16 hands a route handler `params` as a promise. Awaiting it here means
 * no individual handler has to remember to.
 */
type NextRouteArgs<P> = { params: Promise<P> };

/**
 * A handler may return a `Response` it built itself (a non-200, a PDF stream)
 * or a plain object to be serialised. Anything already a Response passes
 * through untouched — including a plain `Response`, not just `NextResponse`.
 */
function finish(result: unknown): Response {
  return result instanceof Response ? result : NextResponse.json(result ?? null);
}

export function route<P extends Record<string, string> = Record<string, string>>(
  options: RouteOptions & { guard: SessionGuard | PermissionGuard },
  handler: Handler<P>,
): (request: NextRequest, args?: NextRouteArgs<P>) => Promise<Response>;

export function route<P extends Record<string, string> = Record<string, string>>(
  options: RouteOptions & { guard: PublicGuard },
  handler: PublicHandler<P>,
): (request: NextRequest, args?: NextRouteArgs<P>) => Promise<Response>;

export function route<P extends Record<string, string> = Record<string, string>>(
  options: RouteOptions,
  handler: Handler<P> | PublicHandler<P>,
) {
  const realm: Realm = options.realm ?? "web";

  return async function handle(request: NextRequest, args?: NextRouteArgs<P>): Promise<Response> {
    const url = new URL(request.url);
    const context = `${request.method} ${url.pathname}`;

    try {
      const params = ((await args?.params) ?? {}) as P;
      const session = await readSession(realm);

      if (options.guard.kind === "public") {
        return finish(await (handler as PublicHandler<P>)({ request, url, params, session }));
      }

      if (!session) throw new AuthError("unauthenticated");

      if (
        options.guard.kind === "permission" &&
        !hasPermission(session, options.guard.permission)
      ) {
        throw new AuthError("forbidden");
      }

      return finish(
        await (handler as Handler<P>)({
          request,
          url,
          params,
          session,
          tenantId: session.tenantId,
        }),
      );
    } catch (error) {
      // `notFound()`, `redirect()` and `forbidden()` signal control flow by
      // throwing. Next identifies them by a `digest` string and handles them
      // itself — swallowing one here turns an intended 404 into a 500, so
      // they are re-thrown ahead of the error mapper.
      if (isNextControlFlow(error)) throw error;
      return toErrorResponse(error, context);
    }
  };
}

/**
 * Whether a throw is Next's own control flow rather than a failure.
 *
 * Matched on the `digest` marker because the framework's type guards are
 * internal; the markers themselves are part of the rendering contract and are
 * what Next matches on too.
 */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest !== "string") return false;
  return (
    digest === "NEXT_REDIRECT" ||
    digest.startsWith("NEXT_REDIRECT;") ||
    digest === "NEXT_NOT_FOUND" ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}

/**
 * The sold-to account a customer-plane request acts for.
 *
 * Taken from the session, never from the request. A handler that accepted a
 * KUNNR as a parameter would let any customer read any customer's documents by
 * changing one number, and no permission check would notice — the permission
 * says whether the *role* may read orders, not *whose*.
 */
export function requireKunnr(session: SessionClaims): string {
  if (!session.kunnr) throw new AuthError("no_account");
  return session.kunnr;
}
