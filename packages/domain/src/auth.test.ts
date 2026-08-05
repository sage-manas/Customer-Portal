import { describe, expect, it } from "vitest";

import {
  LEGACY_ROLES,
  LEGACY_ROLE_MAP,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isBackOfficeRole,
  isCustomerRole,
  isPlatformRole,
  sessionPlane,
  permissionsForRoles,
  rolesWithPermission,
  type Permission,
  type Role,
} from "./auth";

const session = (...roles: Role[]) => ({ roles });

describe("role/permission registry", () => {
  it("has exactly the six identifiers of the five-tier model (doc 09 §5)", () => {
    expect([...ROLES]).toEqual([
      "super_admin",
      "sap_manager",
      "client_admin",
      "ap_manager",
      "ar_manager",
      "customer",
    ]);
  });

  it("assigns a permission set to every role", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role], role).toBeDefined();
      expect(ROLE_PERMISSIONS[role].length, role).toBeGreaterThan(0);
    }
  });

  it("grants only permissions that exist in the registry", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} -> ${permission}`).toBe(true);
      }
    }
  });

  it("lists no permission twice on a role (the composed sets stay a set)", () => {
    for (const role of ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size, role).toBe(granted.length);
    }
  });

  it("unions permissions across multiple roles", () => {
    const granted = permissionsForRoles(["ap_manager", "ar_manager"]);
    expect(granted.has("finance:ap")).toBe(true);
    expect(granted.has("finance:ar")).toBe(true);
  });
});

describe("client_admin is composed, not hand-listed (doc 09 §2)", () => {
  it("holds everything ap_manager and ar_manager hold", () => {
    // The property that makes composition worth insisting on: a permission
    // added to a desk role can never fail to reach the tenant's admin.
    for (const staffRole of ["ap_manager", "ar_manager"] as const) {
      for (const permission of ROLE_PERMISSIONS[staffRole]) {
        expect(hasPermission(session("client_admin"), permission), permission).toBe(true);
      }
    }
  });

  it("keeps the desks narrower than the admin", () => {
    expect(hasPermission(session("ap_manager"), "finance:ar")).toBe(false);
    expect(hasPermission(session("ar_manager"), "finance:ap")).toBe(false);
    for (const permission of [
      "customer:register",
      "onboarding:approve",
      "tenant:settings",
    ] as const) {
      expect(hasPermission(session("ap_manager"), permission), permission).toBe(false);
      expect(hasPermission(session("ar_manager"), permission), permission).toBe(false);
    }
  });

  it("gives the AR desk the credit release, per the matrix", () => {
    expect(hasPermission(session("ar_manager"), "credit:release")).toBe(true);
    // Deciding a *new* limit stays the admin's: releasing applies the limit
    // that exists, changing it is a different call.
    expect(hasPermission(session("ar_manager"), "credit:decide-limit")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("denies when there is no session (fail closed)", () => {
    expect(hasPermission(null, "order:view")).toBe(false);
    expect(hasPermission(undefined, "order:view")).toBe(false);
  });

  it("gives the customer role the whole buyer plane and nothing else", () => {
    const buyer = session("customer");
    const writes: Permission[] = [
      "order:create",
      "payment:pay",
      "support:create",
      "credit:request",
    ];
    expect(hasPermission(buyer, "order:view")).toBe(true);
    for (const permission of writes) {
      expect(hasPermission(buyer, permission), permission).toBe(true);
    }
    expect(hasAnyPermission(buyer, ["admin:view", "finance:ap", "platform:operate"])).toBe(false);
  });

  it("keeps back-office permissions away from customers and vice versa", () => {
    expect(hasPermission(session("customer"), "credit:release")).toBe(false);
    expect(hasPermission(session("customer"), "onboarding:approve")).toBe(false);
    expect(hasPermission(session("client_admin"), "payment:pay")).toBe(false);
    expect(hasPermission(session("client_admin"), "order:create")).toBe(false);
  });

  it("keeps platform roles out of tenant data (plane separation)", () => {
    for (const role of ["super_admin", "sap_manager"] as const) {
      const operator = session(role);
      expect(hasPermission(operator, "platform:operate"), role).toBe(true);
      expect(hasPermission(operator, "order:view"), role).toBe(false);
      expect(hasPermission(operator, "admin:view"), role).toBe(false);
    }
  });

  it("holds the sap_manager to SAP config and health only (doc 09 §5)", () => {
    const sapManager = session("sap_manager");
    expect(hasPermission(sapManager, "platform:sap-config")).toBe(true);
    expect(hasPermission(sapManager, "platform:sap-health")).toBe(true);
    for (const permission of [
      "platform:tenant-crud",
      "platform:operators-manage",
      "platform:billing",
    ] as const) {
      expect(hasPermission(sapManager, permission), permission).toBe(false);
    }
  });

  it("gives only client_admin the settings and customer-master permissions", () => {
    for (const permission of [
      "tenant:settings",
      "customer:register",
      "customer:edit",
      "customer:deactivate",
    ] as const) {
      expect(
        ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(permission)),
        permission,
      ).toEqual(["client_admin"]);
    }
  });
});

describe("rolesWithPermission", () => {
  it("is the exact inverse of the role table", () => {
    for (const permission of PERMISSIONS) {
      const granted = rolesWithPermission(permission);
      for (const role of ROLES) {
        expect(granted.includes(role), `${role} / ${permission}`).toBe(
          hasPermission(session(role), permission),
        );
      }
    }
  });

  it("grants every declared permission to at least one role", () => {
    // A permission nothing holds is either a typo or a screen nobody can
    // reach; both are worth failing on rather than discovering in QA.
    for (const permission of PERMISSIONS) {
      expect(rolesWithPermission(permission).length, permission).toBeGreaterThan(0);
    }
  });

  it("keeps a customer-plane permission out of the back office and vice versa", () => {
    // The property A7's fan-out leans on: resolving recipients by permission
    // cannot reach across planes, because no role holds both sides.
    expect(rolesWithPermission("support:resolve").every(isBackOfficeRole)).toBe(true);
    expect(rolesWithPermission("payment:pay").every(isCustomerRole)).toBe(true);
    expect(rolesWithPermission("platform:sap-config").every(isPlatformRole)).toBe(true);
  });
});

describe("role families", () => {
  it("classifies every role into exactly one plane", () => {
    for (const role of ROLES) {
      const flags = [isCustomerRole(role), isBackOfficeRole(role), isPlatformRole(role)];
      expect(flags.filter(Boolean).length, role).toBe(1);
    }
  });

  it("gives every role a session plane, and the empty session none", () => {
    // The property the portal shell leans on (ADR-062): a session always has
    // an answer, so a shell never has to guess from a role name.
    expect(sessionPlane(null)).toBe("none");
    expect(sessionPlane({ roles: [] })).toBe("none");

    for (const role of ROLES) {
      const plane = sessionPlane({ roles: [role] });
      expect(plane, role).not.toBe("none");
      expect(
        plane === "platform"
          ? isPlatformRole(role)
          : plane === "back_office"
            ? isBackOfficeRole(role)
            : isCustomerRole(role),
        role,
      ).toBe(true);
    }
  });

  it("resolves a mixed-plane session to the widest plane", () => {
    // Not a state the seeds or the migration produce; asserted so that if one
    // ever does, the session lands in the console rather than in a portal it
    // holds no KUNNR for.
    expect(sessionPlane({ roles: ["customer", "client_admin"] })).toBe("back_office");
    expect(sessionPlane({ roles: ["customer", "super_admin"] })).toBe("platform");
  });
});

describe("legacy mapping (doc 09 §3.1)", () => {
  it("maps every legacy role to a role that exists today", () => {
    for (const legacy of LEGACY_ROLES) {
      const target = LEGACY_ROLE_MAP[legacy];
      expect(ROLES.includes(target), legacy).toBe(true);
    }
  });

  it("keeps each legacy role in its own plane", () => {
    // A migration that moved a buyer into the back office, or an operator
    // into a tenant, would be a privilege escalation performed by a script.
    expect(isCustomerRole(LEGACY_ROLE_MAP.buyer_admin)).toBe(true);
    expect(isCustomerRole(LEGACY_ROLE_MAP.buyer_user)).toBe(true);
    expect(isCustomerRole(LEGACY_ROLE_MAP.buyer_view_only)).toBe(true);
    expect(isBackOfficeRole(LEGACY_ROLE_MAP.tenant_admin)).toBe(true);
    expect(isBackOfficeRole(LEGACY_ROLE_MAP.tenant_credit)).toBe(true);
    expect(isPlatformRole(LEGACY_ROLE_MAP.platform_operator)).toBe(true);
  });
});
