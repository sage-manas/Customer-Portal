import {
  ROLES,
  apiRouteKey,
  apiRoutesForPlane,
  rolesAllowedOn,
  type ApiRoute,
  type Permission,
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

  /**
   * The console's headline acceptance criterion (doc 09 §5): "SAP manager
   * can edit a tenant's SAP config and see health, but cannot see tenants
   * list CRUD actions or billing."
   *
   * Until Phase 4 this was one assertion — `sap_manager` reaches nothing —
   * which was true only because the role had no screens yet, and would have
   * quietly become the *wrong* assertion the moment it did. It is now two,
   * because the criterion has always had two halves and only the first was
   * ever checkable: what the role can reach, and what it cannot.
   */
  it("lets sap_manager reach exactly the SAP screens (doc 09 §5)", () => {
    const reachable = opsRoutes.filter(
      (route) =>
        route.guard.kind === "permission" &&
        callGuard(route, claimsFor("sap_manager")) === "allowed",
    );

    // Derived, not listed: a new SAP route is admitted by this assertion
    // automatically, and a route that sneaks in under any *other*
    // permission fails it. The permission a route declares is the only
    // thing consulted — which is the registry doing the work rather than a
    // fixture somebody has to remember to extend.
    const permissions = new Set(
      reachable.map((route) => (route.guard.kind === "permission" ? route.guard.permission : "")),
    );
    expect([...permissions].sort()).toEqual(["platform:sap-config", "platform:sap-health"]);
  });

  it("keeps sap_manager out of tenant CRUD, operator management and billing (doc 09 §5)", () => {
    // Asserted by name as well as by the loop above, so a future
    // `platform:tenant-crud` added to the SAP group breaks a test whose
    // message says what was lost rather than only a row in a matrix.
    const forbidden: Permission[] = ["platform:tenant-crud", "platform:operators-manage"];

    for (const permission of forbidden) {
      const routes = opsRoutes.filter(
        (route) => route.guard.kind === "permission" && route.guard.permission === permission,
      );
      // A permission whose routes were all deleted would pass the loop
      // below vacuously, so the existence of the surface is asserted too.
      expect(routes.length, `no route declares ${permission}`).toBeGreaterThan(0);

      for (const route of routes) {
        expect(callGuard(route, claimsFor("sap_manager")), apiRouteKey(route)).toBe(403);
      }
    }
  });

  it("has no API surface for billing at all, which is where its guard lives", () => {
    // `platform:billing` is deliberately absent from the third assertion
    // above, and this says so rather than leaving a reader to notice the
    // gap: `/billing` is a server-rendered stub that reads the service
    // directly and exposes no handler, so nothing here *can* enforce it.
    // Its two guards are `requireOperatorPage("platform:billing")` on the
    // page and the nav registry (navigation.test.ts asserts `sap_manager`
    // sees exactly SAP Config and SAP Health). When billing grows a
    // handler, this test fails and the route belongs in the list above.
    const billingRoutes = opsRoutes.filter(
      (route) => route.guard.kind === "permission" && route.guard.permission === "platform:billing",
    );
    expect(billingRoutes.map(apiRouteKey)).toEqual([]);
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
