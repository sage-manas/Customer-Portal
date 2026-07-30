import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  hasAnyPermission,
  hasPermission,
  isBackOfficeRole,
  isBuyerRole,
  permissionsForRoles,
  rolesWithPermission,
  type Permission,
  type Role,
} from "./auth";

const session = (...roles: Role[]) => ({ roles });

describe("role/permission registry", () => {
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

  it("unions permissions across multiple roles", () => {
    const granted = permissionsForRoles(["tenant_credit", "tenant_support"]);
    expect(granted.has("credit:release")).toBe(true);
    expect(granted.has("support:resolve")).toBe(true);
  });
});

describe("hasPermission", () => {
  it("denies when there is no session (fail closed)", () => {
    expect(hasPermission(null, "order:view")).toBe(false);
    expect(hasPermission(undefined, "order:view")).toBe(false);
  });

  it("gives buyer_view_only reads but no writes (docs/05 §4.3)", () => {
    const viewer = session("buyer_view_only");
    const writes: Permission[] = ["order:create", "payment:pay", "support:create"];
    expect(hasPermission(viewer, "order:view")).toBe(true);
    for (const permission of writes) {
      expect(hasPermission(viewer, permission), permission).toBe(false);
    }
    expect(hasAnyPermission(viewer, writes)).toBe(false);
  });

  it("keeps back-office permissions away from buyers and vice versa", () => {
    expect(hasPermission(session("buyer_admin"), "credit:release")).toBe(false);
    expect(hasPermission(session("buyer_admin"), "onboarding:approve")).toBe(false);
    expect(hasPermission(session("tenant_sales"), "payment:pay")).toBe(false);
  });

  it("keeps the platform operator out of tenant data (plane separation)", () => {
    const operator = session("platform_operator");
    expect(hasPermission(operator, "platform:operate")).toBe(true);
    expect(hasPermission(operator, "order:view")).toBe(false);
    expect(hasPermission(operator, "admin:view")).toBe(false);
  });

  it("gives only tenant_admin the settings permission", () => {
    const withSettings = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("tenant:settings"));
    expect(withSettings).toEqual(["tenant_admin"]);
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

  it("keeps a customer-plane permission out of the back office and vice versa", () => {
    // The property A7's fan-out leans on: resolving recipients by permission
    // cannot reach across planes, because no role holds both sides.
    expect(rolesWithPermission("support:resolve").every(isBackOfficeRole)).toBe(true);
    expect(rolesWithPermission("payment:pay").every(isBuyerRole)).toBe(true);
  });
});

describe("role families", () => {
  it("classifies every role into exactly one plane", () => {
    for (const role of ROLES) {
      const flags = [isBuyerRole(role), isBackOfficeRole(role), role === "platform_operator"];
      expect(flags.filter(Boolean).length, role).toBe(1);
    }
  });
});
