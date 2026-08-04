import { describe, expect, it } from "vitest";

import {
  API_ROUTES,
  apiRouteKey,
  apiRoutesForPlane,
  findApiRoute,
  rolesAllowedOn,
  rolesOnPlane,
  type ApiRoute,
  type RouteGuard,
} from "./api-routes";
import {
  ROLES,
  isBackOfficeRole,
  isCustomerRole,
  isPlatformRole,
  rolesWithPermission,
} from "./auth";

/**
 * Registry-shape tests. The route x role matrix that *executes* the guard
 * lives where the guard does — `@cc/service-identity/src/authz-matrix.test.ts`
 * for the portal and `@cc/service-platform` for the console, because
 * `@cc/domain` may not import a service (CLAUDE.md rule 1). What is provable
 * here is everything about the declaration itself: that it is well-formed,
 * that the planes do not overlap, and that no row admits nobody.
 */

type PermissionRoute = ApiRoute & { guard: Extract<RouteGuard, { kind: "permission" }> };

const permissionRoutes = API_ROUTES.filter(
  (route): route is PermissionRoute => route.guard.kind === "permission",
);

describe("API_ROUTES shape", () => {
  it("has no duplicate handlers", () => {
    const keys = API_ROUTES.map(apiRouteKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("declares every path under /api/ with no trailing slash", () => {
    for (const route of API_ROUTES) {
      expect(route.path.startsWith("/api/"), route.path).toBe(true);
      expect(route.path.endsWith("/"), route.path).toBe(false);
    }
  });

  it("makes every public route say why it is public", () => {
    for (const route of API_ROUTES) {
      if (route.guard.kind !== "public") continue;
      // A bare `public: true` is a flag nobody can argue with in review.
      expect(route.guard.reason.length, apiRouteKey(route)).toBeGreaterThan(20);
    }
  });

  it("scopes every unauthenticated route to nothing tenant-owned", () => {
    // A public handler has no session, so it cannot have a KUNNR or a user to
    // scope to; one claiming otherwise is reading a boundary out of the
    // request, which is the shape of ADR-025's fail-open.
    for (const route of API_ROUTES) {
      if (route.guard.kind !== "public") continue;
      expect(route.scope, apiRouteKey(route)).toBe("none");
    }
  });
});

describe("plane separation (doc 09 §1)", () => {
  it("puts every role on exactly one plane", () => {
    for (const role of ROLES) {
      const planes = [isPlatformRole(role), isBackOfficeRole(role), isCustomerRole(role)];
      expect(planes.filter(Boolean).length, role).toBe(1);
    }
  });

  it("never admits a platform role to a portal route, or a tenant role to the console", () => {
    for (const route of permissionRoutes) {
      const allowed = rolesAllowedOn(route);
      for (const role of allowed) {
        expect(isPlatformRole(role), `${apiRouteKey(route)} admits ${role}`).toBe(
          route.plane === "ops",
        );
      }
    }
  });

  it("splits the six roles between the two planes with none left over", () => {
    const web = rolesOnPlane("web");
    const ops = rolesOnPlane("ops");
    expect([...web, ...ops].sort()).toEqual([...ROLES].sort());
    expect(web.filter((role) => ops.includes(role))).toEqual([]);
  });
});

describe("rolesAllowedOn", () => {
  it("admits at least one role on every guarded route", () => {
    // A permission no role holds is a route nobody can call — dead code that
    // typechecks. It is only detectable by asking the registry, because the
    // handler compiles perfectly well either way.
    for (const route of API_ROUTES) {
      expect(rolesAllowedOn(route).length, apiRouteKey(route)).toBeGreaterThan(0);
    }
  });

  it("derives from ROLE_PERMISSIONS rather than a second list", () => {
    for (const route of permissionRoutes) {
      const fromRegistry = rolesWithPermission(route.guard.permission).filter((role) =>
        rolesOnPlane(route.plane).includes(role),
      );
      expect(rolesAllowedOn(route).sort()).toEqual(fromRegistry.sort());
    }
  });

  it("lets no back-office role act as a customer", () => {
    const kunnrRoutes = API_ROUTES.filter(
      (route) => route.plane === "web" && route.scope === "kunnr",
    );
    expect(kunnrRoutes.length).toBeGreaterThan(30);

    for (const route of kunnrRoutes) {
      const allowed = rolesAllowedOn(route);
      expect(allowed, apiRouteKey(route)).toContain("customer");

      // Reads may be shared — `catalogue:view` and `order:view` sit in the
      // back-office groups so the quotation desk and the AR workspace can
      // use them, and a back-office session carries no KUNNR, so these
      // handlers answer "no account" rather than somebody else's data.
      // A *write* is different: placing an order, paying an invoice or
      // signing a POD on a customer's behalf is not a thing any desk role
      // does through the customer plane (ADR-032 — the desks have their own
      // entry points), so these admit the buyer alone.
      if (route.method === "GET") continue;
      expect(allowed, apiRouteKey(route)).toEqual(["customer"]);
    }
  });

  it("keeps the AP tray out of AR's hands and vice versa", () => {
    const exceptions = findApiRoute("web", "POST", "/api/admin/exceptions/payments/[id]/retry");
    expect(exceptions).toBeDefined();
    expect(rolesAllowedOn(exceptions!).sort()).toEqual(["ap_manager", "client_admin"]);

    const creditDecision = findApiRoute("web", "POST", "/api/admin/credit/requests/[id]/decision");
    expect(creditDecision).toBeDefined();
    expect(rolesAllowedOn(creditDecision!)).toEqual(["client_admin"]);
  });

  it("gives the tenant admin everything its staff can reach", () => {
    // The payoff of composing `client_admin` from the groups (doc 09 §2): no
    // tenant-plane route exists that a desk role can call and their admin
    // cannot.
    //
    // Both sides are derived rather than named, which is the same discipline
    // the production code follows: the admin is "the back-office role that
    // can register a customer" (doc 09 §2 grants `customer:register` to it
    // alone), and the staff are the other back-office roles. A fourth desk
    // role added in a later phase joins this assertion by existing.
    const admins = ROLES.filter((role) => rolesWithPermission("customer:register").includes(role));
    const staff = ROLES.filter((role) => isBackOfficeRole(role) && !admins.includes(role));
    expect(admins.length).toBe(1);
    expect(staff.length).toBeGreaterThan(0);

    for (const route of apiRoutesForPlane("web")) {
      const allowed = rolesAllowedOn(route);
      if (!staff.some((role) => allowed.includes(role))) continue;
      for (const admin of admins) expect(allowed, apiRouteKey(route)).toContain(admin);
    }
  });

  it("reserves the console for the platform plane", () => {
    for (const route of apiRoutesForPlane("ops")) {
      if (route.guard.kind === "public") continue;
      expect(rolesAllowedOn(route).every(isPlatformRole), apiRouteKey(route)).toBe(true);
    }
    expect(rolesAllowedOn(findApiRoute("ops", "GET", "/api/tenants")!)).toEqual(["super_admin"]);
  });
});
