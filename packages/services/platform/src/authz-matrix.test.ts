import {
  ROLES,
  apiRouteKey,
  apiRoutesForPlane,
  rolesAllowedOn,
  type ApiRoute,
  type Role,
} from "@cc/domain";
import { describe, expect, it } from "vitest";

import { PlatformError } from "./errors";
import { requireOperatorPermission, requireOperatorSession } from "./guard";
import type { OperatorClaims } from "./jwt";

/**
 * The operator-plane half of the route x role matrix — the twin of
 * `@cc/service-identity/src/authz-matrix.test.ts`, generated the same way
 * from the same registry, executing this realm's own guard.
 *
 * Two files rather than one parameterised over the plane, because the two
 * realms genuinely share no code path: different guard, different error
 * class, different status mapping. A single test that abstracted over both
 * would be asserting that the abstraction works, not that either realm
 * does.
 */

const opsRoutes = apiRoutesForPlane("ops");

function claimsFor(role: Role): OperatorClaims {
  return { operatorId: "op_matrix", email: `${role}@matrix.example`, roles: [role] };
}

function callGuard(route: ApiRoute, claims: OperatorClaims | null): number | "allowed" {
  try {
    switch (route.guard.kind) {
      case "permission":
        requireOperatorPermission(claims, route.guard.permission);
        return "allowed";
      case "session":
        requireOperatorSession(claims);
        return "allowed";
      case "public":
        return "allowed";
    }
  } catch (error) {
    if (error instanceof PlatformError) return error.status;
    throw error;
  }
}

describe("route x role matrix (apps/ops)", () => {
  it("covers every declared console route", () => {
    expect(opsRoutes.length).toBeGreaterThan(0);
  });

  for (const route of opsRoutes) {
    const allowed = rolesAllowedOn(route);

    describe(apiRouteKey(route), () => {
      for (const role of ROLES) {
        const shouldPass = allowed.includes(role);

        it(`${shouldPass ? "admits" : "refuses"} ${role}`, () => {
          const result = callGuard(route, claimsFor(role));
          expect(result).toBe(shouldPass ? "allowed" : 403);
        });
      }

      it("refuses an anonymous caller with 401", () => {
        expect(callGuard(route, null)).toBe(route.guard.kind === "public" ? "allowed" : 401);
      });
    });
  }

  it("keeps sap_manager out of tenant CRUD (doc 09 §5)", () => {
    // The console's headline acceptance criterion, asserted by name rather
    // than only as a row in the loop above — a future `platform:tenant-crud`
    // added to the SAP group would break it here with a message that says
    // what was lost.
    const reachable = opsRoutes.filter(
      (route) =>
        route.guard.kind === "permission" &&
        callGuard(route, claimsFor("sap_manager")) === "allowed",
    );
    expect(reachable.map(apiRouteKey)).toEqual([]);
  });
});

describe("tenant roles in the operator realm", () => {
  it("gives a client_admin nothing, even holding a forged claim", () => {
    // `verifyOperatorToken` drops non-platform roles at the parse, so this
    // claim shape cannot arrive from a token. Asserting it anyway means the
    // guard is not relying on that filter for its own correctness —
    // defence in depth across the one boundary doc 09 §1 calls absolute.
    for (const route of opsRoutes) {
      if (route.guard.kind !== "permission") continue;
      expect(callGuard(route, claimsFor("client_admin")), apiRouteKey(route)).toBe(403);
    }
  });
});
