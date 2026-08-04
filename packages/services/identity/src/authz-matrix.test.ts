import {
  ROLES,
  apiRouteKey,
  apiRoutesForPlane,
  rolesAllowedOn,
  type ApiRoute,
  type Role,
  type SessionClaims,
} from "@cc/domain";
import { describe, expect, it } from "vitest";

import { AuthError } from "./errors";
import { requirePermission, requireSession } from "./guard";

/**
 * The route x role authorization matrix (doc 09 §4.4, doc 10 Phase 3).
 *
 * Generated, not written: the routes come from `API_ROUTES` and the roles
 * that may reach each one come from `rolesWithPermission` via
 * `rolesAllowedOn`. Nothing in this file lists a role against a route, so
 * moving `exceptions:view` out of the AP group in `auth.ts` changes what
 * this suite asserts without anybody editing it — which is the property
 * doc 09 §4.4 asks for. A hand-written matrix is a second copy of the
 * permission table, and a second copy drifts.
 *
 * It executes the real guard rather than re-deriving the answer with
 * `hasPermission`. That is the point: `requirePermission` is what the
 * handlers call, so this proves the deployed enforcement path agrees with
 * the registry — including the status code, since "forbidden" being a 403
 * and "no session" a 401 is exactly the distinction doc 09 §1 draws.
 *
 * What it deliberately does not cover: the *data* boundary beneath the
 * permission. A `customer` legitimately holding `order:view` must still get
 * a 404 for another customer's VBELN, and that check lives in the service
 * (`getOrder` compares KUNNR), covered by each service's own tests. The
 * registry records which routes carry that obligation — `scope: "kunnr"` —
 * and each app's `authz-sweep.ts` asserts those handlers take the account
 * from the session rather than from the request.
 */

const webRoutes = apiRoutesForPlane("web");

function sessionFor(role: Role): SessionClaims {
  return {
    userId: "user_matrix",
    tenantId: "tenant_matrix",
    tenantSlug: "matrix",
    email: `${role}@matrix.example`,
    roles: [role],
    kunnr: "0010001001",
    availableKunnrs: ["0010001001"],
  };
}

/** Runs the guard the handler would run, and reports the HTTP answer. */
function callGuard(route: ApiRoute, session: SessionClaims | null): number | "allowed" {
  try {
    switch (route.guard.kind) {
      case "permission":
        requirePermission(session, route.guard.permission);
        return "allowed";
      case "session":
        requireSession(session);
        return "allowed";
      case "public":
        return "allowed";
    }
  } catch (error) {
    if (error instanceof AuthError) return error.status;
    throw error;
  }
}

describe("route x role matrix (apps/web)", () => {
  it("covers every declared portal route", () => {
    // Guards the generator itself: a filter typo that produced an empty
    // list would make every assertion below vacuously pass.
    expect(webRoutes.length).toBeGreaterThan(60);
  });

  for (const route of webRoutes) {
    const allowed = rolesAllowedOn(route);

    describe(apiRouteKey(route), () => {
      for (const role of ROLES) {
        const shouldPass = allowed.includes(role);

        it(`${shouldPass ? "admits" : "refuses"} ${role}`, () => {
          const result = callGuard(route, sessionFor(role));
          if (shouldPass) {
            expect(result).toBe("allowed");
          } else {
            // 403, not 404: the caller exists in this tenant and simply
            // lacks the permission. 404 is reserved for cross-tenant and
            // cross-KUNNR, where confirming existence is itself the leak
            // (CLAUDE.md rule 5) — and that answer comes from the service,
            // not from here.
            expect(result).toBe(403);
          }
        });
      }

      it("refuses an anonymous caller with 401", () => {
        const result = callGuard(route, null);
        expect(result).toBe(route.guard.kind === "public" ? "allowed" : 401);
      });
    });
  }
});

describe("platform roles on the portal plane", () => {
  it("gives a super_admin no reach into any tenant route", () => {
    // The strongest role in the system holds zero tenant-data permissions
    // (doc 09 §1). This is worth asserting separately from the matrix
    // because it is the property most likely to be quietly lost when a
    // future permission is added to `PLATFORM_SAP` "just to make ops work".
    const reachable = webRoutes.filter(
      (route) =>
        route.guard.kind === "permission" &&
        callGuard(route, sessionFor("super_admin")) === "allowed",
    );
    expect(reachable.map(apiRouteKey)).toEqual([]);
  });

  it("gives a sap_manager no reach into any tenant route", () => {
    const reachable = webRoutes.filter(
      (route) =>
        route.guard.kind === "permission" &&
        callGuard(route, sessionFor("sap_manager")) === "allowed",
    );
    expect(reachable.map(apiRouteKey)).toEqual([]);
  });
});
